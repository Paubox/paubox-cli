import { createProgram } from '../../src/index';
import { MarketingApiClient } from '../../src/lib/marketing-api';
import * as credentials from '../../src/lib/credentials';
import { ConfigError } from '../../src/lib/errors';

jest.mock('../../src/lib/marketing-api');
jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/api', () => ({
  PauboxApiClient: jest.fn(),
  resolveAttachments: jest.fn(),
}));

const MockMarketingApiClient = MarketingApiClient as jest.MockedClass<typeof MarketingApiClient>;
const mockLoadCredentials = credentials.loadCredentials as jest.Mock;

const CREDS = { apiKey: 'email-key-123', formsApiKey: 'forms-key' };

const SUBSCRIBERS_RESPONSE = {
  data: [
    {
      id: 'sub-1',
      type: 'subscriber',
      attributes: {
        email: 'jane@example.com',
        full_name: 'Jane Doe',
        phone_number: null,
        first_name: 'Jane',
        last_name: 'Doe',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    },
  ],
  total_count: 1,
};

const SUBSCRIBER_RESPONSE = {
  data: {
    id: 'sub-1',
    type: 'subscriber',
    attributes: {
      ...SUBSCRIBERS_RESPONSE.data[0].attributes,
      unsubscribed: false,
      custom_fields: [
        { subscriber_custom_field_type_id: 'cf-1', name: 'Clinic', value: 'North' },
      ],
      subscription_lists: [{ id: 7, name: 'All contacts', unsubscribed: false }],
    },
  },
};

const LISTS_RESPONSE = {
  data: [
    {
      id: '7',
      type: 'subscription_list',
      attributes: { name: 'All contacts', subscriber_count: 120, is_default: true },
    },
  ],
  page_info: { count: 1, pages: 1, page: 1, items: 10 },
};

const CAMPAIGNS_RESPONSE = {
  data: [
    {
      id: '31',
      type: 'campaign_mailing',
      attributes: {
        subject: 'August newsletter',
        default_subject: null,
        template_type: 'standard',
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-02T00:00:00Z',
        sent_count: 500,
        delivered_count: 495,
        viewed_count: 300,
        clicked_count: 90,
      },
    },
  ],
};

function captureStdout(): jest.SpyInstance {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

function joined(spy: jest.SpyInstance): string {
  return spy.mock.calls.map((c) => c[0]).join('');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadCredentials.mockResolvedValue(CREDS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('client construction', () => {
  it('uses the stored email API key, not the forms key', async () => {
    captureStdout();
    MockMarketingApiClient.prototype.listBulkJobs = jest.fn().mockResolvedValue({ data: [] });

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'jobs', 'list']);

    expect(MockMarketingApiClient).toHaveBeenCalledWith(undefined, 'email-key-123');
  });

  it('passes null when no credentials are stored', async () => {
    captureStdout();
    mockLoadCredentials.mockResolvedValue(null);
    MockMarketingApiClient.prototype.listBulkJobs = jest.fn().mockResolvedValue({ data: [] });

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'jobs', 'list']);

    expect(MockMarketingApiClient).toHaveBeenCalledWith(undefined, null);
  });

  it('treats an empty apiKey from auth set-forms-key as unset', async () => {
    captureStdout();
    mockLoadCredentials.mockResolvedValue({ apiKey: '', formsApiKey: 'forms-key' });
    MockMarketingApiClient.prototype.listBulkJobs = jest.fn().mockResolvedValue({ data: [] });

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'jobs', 'list']);

    expect(MockMarketingApiClient).toHaveBeenCalledWith(undefined, null);
  });
});

describe('paubox marketing subscribers list', () => {
  beforeEach(() => {
    MockMarketingApiClient.prototype.listSubscribers = jest
      .fn()
      .mockResolvedValue(SUBSCRIBERS_RESPONSE);
  });

  it('passes all parsed options through', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'list',
      '--search', 'jane',
      '--subscription-list-id', 'list-1',
      '--dynamic-list-id', 'dyn-1',
      '--page', '2',
      '--items', '25',
      '--order-by', 'created_at',
      '--order', 'desc',
    ]);

    expect(MockMarketingApiClient.prototype.listSubscribers).toHaveBeenCalledWith({
      search: 'jane',
      subscriptionListId: 'list-1',
      dynamicListId: 'dyn-1',
      page: 2,
      items: 25,
      orderBy: 'created_at',
      order: 'desc',
    });
  });

  it('sends an empty params object when no flags are given', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'list',
    ]);

    expect(MockMarketingApiClient.prototype.listSubscribers).toHaveBeenCalledWith({});
  });

  it('prints a table and the total count', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'list',
    ]);

    const out = joined(spy);
    expect(out).toContain('jane@example.com');
    expect(out).toContain('Jane Doe');
    expect(out).toContain('1 subscriber(s) total');
  });

  it('prints raw JSON with --json', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'marketing', 'subscribers', 'list',
    ]);

    expect(JSON.parse(joined(spy))).toEqual(SUBSCRIBERS_RESPONSE);
  });

  it('rejects a non-integer --page', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscribers', 'list', '--page', 'two',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('rejects an unsupported --order-by column', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscribers', 'list', '--order-by', 'ssn',
      ]),
    ).rejects.toThrow(/--order-by must be one of/);
  });

  it('rejects an unsupported --order direction', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscribers', 'list', '--order', 'sideways',
      ]),
    ).rejects.toThrow(/--order must be one of/);
  });
});

describe('paubox marketing subscribers get', () => {
  beforeEach(() => {
    MockMarketingApiClient.prototype.getSubscriber = jest
      .fn()
      .mockResolvedValue(SUBSCRIBER_RESPONSE);
  });

  it('passes the subscriber ID and flags', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'get', 'sub-1',
      '--subscription-list-id', 'list-1',
      '--with-stats',
    ]);

    expect(MockMarketingApiClient.prototype.getSubscriber).toHaveBeenCalledWith('sub-1', {
      subscriptionListId: 'list-1',
      withStats: true,
    });
  });

  it('omits withStats when the flag is absent', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'get', 'sub-1',
    ]);

    expect(MockMarketingApiClient.prototype.getSubscriber).toHaveBeenCalledWith('sub-1', {});
  });

  it('prints the detail view including custom fields and list membership', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'get', 'sub-1',
    ]);

    const out = joined(spy);
    expect(out).toContain('jane@example.com');
    expect(out).toContain('Clinic: North');
    expect(out).toContain('list 7 All contacts unsubscribed=false');
  });

  it('errors when the API returns a 200 with a null subscriber', async () => {
    captureStdout();
    MockMarketingApiClient.prototype.getSubscriber = jest.fn().mockResolvedValue({ data: null });

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscribers', 'get', 'missing',
      ]),
    ).rejects.toThrow(/Subscriber "missing" not found/);
  });

  it('still emits the null payload with --json rather than erroring', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.getSubscriber = jest.fn().mockResolvedValue({ data: null });

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'marketing', 'subscribers', 'get', 'missing',
    ]);

    expect(JSON.parse(joined(spy))).toEqual({ data: null });
  });
});

describe('paubox marketing subscribers count', () => {
  it('prints the count', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.getSubscribedCount = jest
      .fn()
      .mockResolvedValue({ data: 120 });

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'count',
      '--subscription-list-id', 'list-1',
    ]);

    expect(MockMarketingApiClient.prototype.getSubscribedCount).toHaveBeenCalledWith({
      subscriptionListId: 'list-1',
    });
    expect(joined(spy)).toContain('Subscribed: 120');
  });
});

describe('paubox marketing lists list', () => {
  beforeEach(() => {
    MockMarketingApiClient.prototype.listLists = jest.fn().mockResolvedValue(LISTS_RESPONSE);
  });

  it('passes parsed options through', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'lists', 'list',
      '--search', 'contacts',
      '--page', '1',
      '--items', '10',
      '--order-by', 'subscriber_count',
      '--order', 'desc',
    ]);

    expect(MockMarketingApiClient.prototype.listLists).toHaveBeenCalledWith({
      search: 'contacts',
      page: 1,
      items: 10,
      orderBy: 'subscriber_count',
      order: 'desc',
    });
  });

  it('prints the list table and pagination footer', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'lists', 'list']);

    const out = joined(spy);
    expect(out).toContain('All contacts');
    expect(out).toContain('120');
    expect(out).toContain('Page 1 of 1 (1 lists total)');
  });

  it('falls back to a plain count when the response has no page_info', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.listLists = jest
      .fn()
      .mockResolvedValue({ data: LISTS_RESPONSE.data });

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'lists', 'list']);

    expect(joined(spy)).toContain('1 list(s)');
  });
});

describe('paubox marketing campaigns', () => {
  beforeEach(() => {
    MockMarketingApiClient.prototype.listCampaigns = jest
      .fn()
      .mockResolvedValue(CAMPAIGNS_RESPONSE);
    MockMarketingApiClient.prototype.getCampaign = jest
      .fn()
      .mockResolvedValue({ data: CAMPAIGNS_RESPONSE.data[0] });
  });

  it('passes list filters through', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'campaigns', 'list',
      '--search', 'newsletter',
      '--page', '2',
      '--template-type', 'standard',
      '--order-by', 'created_at',
      '--order', 'asc',
    ]);

    expect(MockMarketingApiClient.prototype.listCampaigns).toHaveBeenCalledWith({
      search: 'newsletter',
      page: 2,
      templateType: 'standard',
      orderBy: 'created_at',
      order: 'asc',
    });
  });

  it('prints the campaign table', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'campaigns', 'list']);

    const out = joined(spy);
    expect(out).toContain('August newsletter');
    expect(out).toContain('1 campaign(s)');
  });

  it('passes --with-images to getCampaign', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'campaigns', 'get', '31', '--with-images',
    ]);

    expect(MockMarketingApiClient.prototype.getCampaign).toHaveBeenCalledWith('31', {
      withImages: true,
    });
  });

  it('prints campaign detail', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'campaigns', 'get', '31']);

    expect(joined(spy)).toContain('August newsletter');
  });

  it('errors when the campaign is missing', async () => {
    captureStdout();
    MockMarketingApiClient.prototype.getCampaign = jest.fn().mockResolvedValue({ data: null });

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'marketing', 'campaigns', 'get', '999']),
    ).rejects.toThrow(/Campaign "999" not found/);
  });
});

describe('paubox marketing analytics', () => {
  beforeEach(() => {
    MockMarketingApiClient.prototype.getAnalytics = jest
      .fn()
      .mockResolvedValue({ data: [{ id: 1 }] });
  });

  it('passes the report type and params', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'analytics', 'campaign_mailing_sends_table',
      '--drip-campaign-id', 'drip-1',
      '--start-date', '2026-01-01',
      '--end-date', '2026-02-01',
      '--by-date',
      '--date-offset', '30',
      '--with-stats',
      '--order', 'asc',
    ]);

    expect(MockMarketingApiClient.prototype.getAnalytics).toHaveBeenCalledWith(
      'campaign_mailing_sends_table',
      {
        dripCampaignId: 'drip-1',
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        byDate: true,
        dateOffset: 30,
        withStats: true,
        order: 'asc',
      },
    );
  });

  it('always prints JSON, since each report has its own shape', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'analytics', 'campaign_mailing_send_totals',
    ]);

    expect(JSON.parse(joined(spy))).toEqual({ data: [{ id: 1 }] });
  });

  it('rejects a report type the server cannot resolve', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'analytics', 'everything',
      ]),
    ).rejects.toThrow(/analytics type must be one of/);
    expect(MockMarketingApiClient.prototype.getAnalytics).not.toHaveBeenCalled();
  });
});

describe('paubox marketing jobs', () => {
  it('reports when there are no active jobs', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.listBulkJobs = jest.fn().mockResolvedValue({ data: [] });

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'jobs', 'list']);

    expect(joined(spy)).toContain('No active bulk jobs.');
  });

  it('prints a table of active jobs', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.listBulkJobs = jest
      .fn()
      .mockResolvedValue({ data: [{ total_jobs: 5, failures: 1, pending: 2 }] });

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'jobs', 'list']);

    const out = joined(spy);
    expect(out).toContain('TOTAL');
    expect(out).toContain('5');
  });

  it('shows a single job by batch ID', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.getBulkJob = jest
      .fn()
      .mockResolvedValue({ data: { total_jobs: 5, failures: 0, pending: 3 } });

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'jobs', 'get', 'bid-1']);

    expect(MockMarketingApiClient.prototype.getBulkJob).toHaveBeenCalledWith('bid-1');
    const out = joined(spy);
    expect(out).toContain('Total jobs: 5');
    expect(out).toContain('Pending:    3');
  });
});
