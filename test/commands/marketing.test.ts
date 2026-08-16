import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/index';
import { MarketingApiClient } from '../../src/lib/marketing-api';
import * as credentials from '../../src/lib/credentials';
import { confirmDestructive } from '../../src/lib/confirm';
import { ConfigError } from '../../src/lib/errors';

jest.mock('../../src/lib/marketing-api');
jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/confirm');
jest.mock('../../src/lib/api', () => ({
  PauboxApiClient: jest.fn(),
  resolveAttachments: jest.fn(),
}));

const MockMarketingApiClient = MarketingApiClient as jest.MockedClass<typeof MarketingApiClient>;
const mockLoadCredentials = credentials.loadCredentials as jest.Mock;
const mockConfirmDestructive = confirmDestructive as jest.Mock;

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
  mockConfirmDestructive.mockResolvedValue(undefined);
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

describe('paubox marketing subscribers create', () => {
  beforeEach(() => {
    MockMarketingApiClient.prototype.createSubscriber = jest
      .fn()
      .mockResolvedValue(SUBSCRIBER_RESPONSE);
  });

  it('nests subscriber attributes and keeps the list ID at the top level', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'create',
      '--email', 'jane@example.com',
      '--first-name', 'Jane',
      '--last-name', 'Doe',
      '--phone', '+15555550123',
      '--subscription-list-id', 'list-1',
    ]);

    expect(MockMarketingApiClient.prototype.createSubscriber).toHaveBeenCalledWith({
      subscriber: {
        email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        phone_number: '+15555550123',
      },
      subscription_list_id: 'list-1',
    });
  });

  it('sends custom fields as a custom_fields array', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'create',
      '--email', 'jane@example.com',
      '--field', 'Clinic=North Campus', 'Plan=Gold',
    ]);

    expect(MockMarketingApiClient.prototype.createSubscriber).toHaveBeenCalledWith({
      subscriber: {
        email: 'jane@example.com',
        custom_fields: [
          { name: 'Clinic', value: 'North Campus' },
          { name: 'Plan', value: 'Gold' },
        ],
      },
    });
  });

  it('keeps "=" inside a custom field value', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'create',
      '--email', 'jane@example.com',
      '--field', 'Query=a=b',
    ]);

    expect(MockMarketingApiClient.prototype.createSubscriber).toHaveBeenCalledWith({
      subscriber: {
        email: 'jane@example.com',
        custom_fields: [{ name: 'Query', value: 'a=b' }],
      },
    });
  });

  it('rejects a --field without an "="', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscribers', 'create',
        '--email', 'jane@example.com', '--field', 'Clinic',
      ]),
    ).rejects.toThrow(/--field must be a key=value pair/);
  });

  it('rejects a --field with an empty name', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscribers', 'create',
        '--email', 'jane@example.com', '--field', '=orphan',
      ]),
    ).rejects.toThrow(/--field must be a key=value pair/);
  });

  it('refuses to send an empty subscriber payload', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscribers', 'create',
      ]),
    ).rejects.toThrow(/Nothing to send/);
    expect(MockMarketingApiClient.prototype.createSubscriber).not.toHaveBeenCalled();
  });

  it('confirms the created subscriber', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'create', '--email', 'jane@example.com',
    ]);

    expect(joined(spy)).toContain('Created subscriber sub-1');
  });
});

describe('paubox marketing subscribers update', () => {
  beforeEach(() => {
    MockMarketingApiClient.prototype.updateSubscriber = jest
      .fn()
      .mockResolvedValue(SUBSCRIBER_RESPONSE);
  });

  it('sends only the fields that were provided', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'update', 'sub-1', '--first-name', 'Janet',
    ]);

    expect(MockMarketingApiClient.prototype.updateSubscriber).toHaveBeenCalledWith('sub-1', {
      subscriber: { first_name: 'Janet' },
    });
  });

  it('refuses an update with no fields', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscribers', 'update', 'sub-1',
      ]),
    ).rejects.toThrow(/Nothing to send/);
  });
});

describe('paubox marketing subscribers CSV exports', () => {
  const EXPORT = { data: { sent_to_email: 'me@example.com', jid: 'job-1' } };

  beforeEach(() => {
    MockMarketingApiClient.prototype.exportSubscribersCsv = jest.fn().mockResolvedValue(EXPORT);
    MockMarketingApiClient.prototype.exportDynamicListCsv = jest.fn().mockResolvedValue(EXPORT);
  });

  it('passes export filters through', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'export-csv',
      '--email', 'me@example.com',
      '--from-subscription-list-id', 'list-1',
      '--search', 'jane',
      '--subscriber-id', 'a', 'b',
      '--except-id', 'c',
    ]);

    expect(MockMarketingApiClient.prototype.exportSubscribersCsv).toHaveBeenCalledWith({
      email: 'me@example.com',
      fromSubscriptionListId: 'list-1',
      search: 'jane',
      subscriberIds: ['a', 'b'],
      exceptIds: ['c'],
    });
  });

  it('reports the job ID so it can be polled with jobs get', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'export-csv', '--email', 'me@example.com',
    ]);

    const out = joined(spy);
    expect(out).toContain('will be emailed to me@example.com');
    expect(out).toContain('Job ID: job-1');
  });

  it('passes dynamic list export params through', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscribers', 'export-dynamic-csv',
      '--email', 'me@example.com',
      '--dynamic-list-id', 'dyn-1',
      '--order-by', 'created_at',
      '--order', 'desc',
    ]);

    expect(MockMarketingApiClient.prototype.exportDynamicListCsv).toHaveBeenCalledWith({
      email: 'me@example.com',
      dynamicListId: 'dyn-1',
      orderBy: 'created_at',
      order: 'desc',
    });
  });
});

describe('paubox marketing subscriptions', () => {
  beforeEach(() => {
    MockMarketingApiClient.prototype.subscribe = jest
      .fn()
      .mockResolvedValue({ data: [SUBSCRIBERS_RESPONSE.data[0]] });
    MockMarketingApiClient.prototype.unsubscribe = jest
      .fn()
      .mockResolvedValue({ data: [SUBSCRIBERS_RESPONSE.data[0]] });
  });

  it('subscribes without prompting', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscriptions', 'subscribe',
      '--subscriber-id', 'a', 'b',
      '--subscription-list-id', '1',
    ]);

    expect(MockMarketingApiClient.prototype.subscribe).toHaveBeenCalledWith({
      subscriber_ids: ['a', 'b'],
      subscription_list_ids: ['1'],
    });
    expect(mockConfirmDestructive).not.toHaveBeenCalled();
  });

  it('does not prompt for a list-scoped unsubscribe', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscriptions', 'unsubscribe',
      '--subscriber-id', 'a',
      '--subscription-list-id', '1',
    ]);

    expect(mockConfirmDestructive).not.toHaveBeenCalled();
    expect(MockMarketingApiClient.prototype.unsubscribe).toHaveBeenCalledWith({
      subscriber_ids: ['a'],
      subscription_list_ids: ['1'],
    });
  });

  it('confirms before a global unsubscribe, since it spans every list', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscriptions', 'unsubscribe', '--subscriber-id', 'a', 'b',
    ]);

    expect(mockConfirmDestructive).toHaveBeenCalledWith(
      expect.stringContaining('ALL lists'),
      undefined,
    );
    expect(MockMarketingApiClient.prototype.unsubscribe).toHaveBeenCalledWith({
      subscriber_ids: ['a', 'b'],
    });
  });

  it('forwards --yes to the confirmation helper', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscriptions', 'unsubscribe', '--subscriber-id', 'a', '--yes',
    ]);

    expect(mockConfirmDestructive).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('does not call the API when confirmation is declined', async () => {
    captureStdout();
    mockConfirmDestructive.mockRejectedValue(new ConfigError('Aborted.'));

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscriptions', 'unsubscribe', '--subscriber-id', 'a',
      ]),
    ).rejects.toThrow(/Aborted/);
    expect(MockMarketingApiClient.prototype.unsubscribe).not.toHaveBeenCalled();
  });

  it('describes the scope of the change', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscriptions', 'unsubscribe', '--subscriber-id', 'a', '--yes',
    ]);

    expect(joined(spy)).toContain('Unsubscribed 1 subscriber(s) globally');
  });
});

describe('paubox marketing subscription-lists', () => {
  const LIST = {
    data: {
      id: '7',
      type: 'subscription_list',
      attributes: { name: 'VIPs', subscriber_count: 12, is_default: false },
    },
  };

  beforeEach(() => {
    MockMarketingApiClient.prototype.listSubscriptionLists = jest
      .fn()
      .mockResolvedValue(LISTS_RESPONSE);
    MockMarketingApiClient.prototype.getSubscriptionList = jest.fn().mockResolvedValue(LIST);
    MockMarketingApiClient.prototype.createSubscriptionList = jest.fn().mockResolvedValue(LIST);
    MockMarketingApiClient.prototype.updateSubscriptionList = jest.fn().mockResolvedValue(LIST);
    MockMarketingApiClient.prototype.deleteSubscriptionList = jest.fn().mockResolvedValue(undefined);
  });

  it('lists with parsed pagination options', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscription-lists', 'list',
      '--page', '2', '--items', '25', '--order-by', 'name', '--order', 'asc',
    ]);

    expect(MockMarketingApiClient.prototype.listSubscriptionLists).toHaveBeenCalledWith({
      page: 2,
      items: 25,
      orderBy: 'name',
      order: 'asc',
    });
  });

  it('supports the "default" alias on get', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscription-lists', 'get', 'default',
    ]);

    expect(MockMarketingApiClient.prototype.getSubscriptionList).toHaveBeenCalledWith('default', {});
    expect(joined(spy)).toContain('VIPs');
  });

  it('passes --with-stats on get', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscription-lists', 'get', '7', '--with-stats',
    ]);

    expect(MockMarketingApiClient.prototype.getSubscriptionList).toHaveBeenCalledWith('7', {
      withStats: true,
    });
  });

  it('errors when get returns a null record', async () => {
    captureStdout();
    MockMarketingApiClient.prototype.getSubscriptionList = jest
      .fn()
      .mockResolvedValue({ data: null });

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscription-lists', 'get', '999',
      ]),
    ).rejects.toThrow(/Subscription list "999" not found/);
  });

  it('creates a list by name', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscription-lists', 'create', '--name', 'VIPs',
    ]);

    expect(MockMarketingApiClient.prototype.createSubscriptionList).toHaveBeenCalledWith('VIPs');
    expect(joined(spy)).toContain('Created subscription list 7');
  });

  it('renames a list', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscription-lists', 'update', '7', '--name', 'VIP',
    ]);

    expect(MockMarketingApiClient.prototype.updateSubscriptionList).toHaveBeenCalledWith('7', 'VIP');
  });

  it('confirms before deleting', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'subscription-lists', 'delete', '7',
    ]);

    expect(mockConfirmDestructive).toHaveBeenCalledWith(
      expect.stringContaining('Delete subscription list 7'),
      undefined,
    );
    expect(MockMarketingApiClient.prototype.deleteSubscriptionList).toHaveBeenCalledWith('7');
  });

  it('does not delete when confirmation is declined', async () => {
    captureStdout();
    mockConfirmDestructive.mockRejectedValue(new ConfigError('Aborted.'));

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'subscription-lists', 'delete', '7',
      ]),
    ).rejects.toThrow(/Aborted/);
    expect(MockMarketingApiClient.prototype.deleteSubscriptionList).not.toHaveBeenCalled();
  });

  it('emits a JSON receipt for delete with --json', async () => {
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'marketing', 'subscription-lists', 'delete', '7', '--yes',
    ]);

    expect(JSON.parse(joined(spy))).toEqual({ status: 'deleted', id: '7' });
  });
});

describe('paubox marketing dynamic-lists', () => {
  const LIST = {
    data: {
      id: 'dyn-1',
      type: 'dynamic_list',
      attributes: { name: 'Recent signups', subscriber_count: 4, filters: '[]' },
    },
  };
  const FILTERS = '[[{"field":"email","op":"contains","terms":["@example.com"]}]]';

  beforeEach(() => {
    MockMarketingApiClient.prototype.listDynamicLists = jest.fn().mockResolvedValue(LISTS_RESPONSE);
    MockMarketingApiClient.prototype.getDynamicList = jest.fn().mockResolvedValue(LIST);
    MockMarketingApiClient.prototype.createDynamicList = jest.fn().mockResolvedValue(LIST);
    MockMarketingApiClient.prototype.updateDynamicList = jest.fn().mockResolvedValue(LIST);
    MockMarketingApiClient.prototype.deleteDynamicList = jest.fn().mockResolvedValue(undefined);
  });

  it('creates a dynamic list with inline filters', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'dynamic-lists', 'create',
      '--name', 'Recent', '--filters', FILTERS,
    ]);

    expect(MockMarketingApiClient.prototype.createDynamicList).toHaveBeenCalledWith({
      name: 'Recent',
      filters: FILTERS,
    });
  });

  it('rejects filters that are not valid JSON', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'dynamic-lists', 'create',
        '--name', 'Recent', '--filters', 'not json',
      ]),
    ).rejects.toThrow(/Filters must be valid JSON/);
    expect(MockMarketingApiClient.prototype.createDynamicList).not.toHaveBeenCalled();
  });

  it('rejects passing both --filters and --filters-file', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'dynamic-lists', 'create',
        '--name', 'Recent', '--filters', '[]', '--filters-file', './x.json',
      ]),
    ).rejects.toThrow(/not both/);
  });

  it('reports an unreadable --filters-file', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'dynamic-lists', 'create',
        '--name', 'Recent', '--filters-file', '/nonexistent/filters.json',
      ]),
    ).rejects.toThrow(/Cannot read --filters-file/);
  });

  it('refuses an update with neither name nor filters', async () => {
    captureStdout();

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'dynamic-lists', 'update', 'dyn-1',
      ]),
    ).rejects.toThrow(/Nothing to update/);
  });

  it('updates only the name when only --name is given', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'dynamic-lists', 'update', 'dyn-1', '--name', 'Renamed',
    ]);

    expect(MockMarketingApiClient.prototype.updateDynamicList).toHaveBeenCalledWith('dyn-1', {
      name: 'Renamed',
    });
  });

  it('confirms before deleting', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'dynamic-lists', 'delete', 'dyn-1',
    ]);

    expect(mockConfirmDestructive).toHaveBeenCalledWith(
      expect.stringContaining('Delete dynamic list dyn-1'),
      undefined,
    );
    expect(MockMarketingApiClient.prototype.deleteDynamicList).toHaveBeenCalledWith('dyn-1');
  });
});

describe('marketing write commands with --json', () => {
  it('emits the raw create payload', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.createSubscriber = jest
      .fn()
      .mockResolvedValue(SUBSCRIBER_RESPONSE);

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'marketing', 'subscribers', 'create',
      '--email', 'jane@example.com',
    ]);

    expect(JSON.parse(joined(spy))).toEqual(SUBSCRIBER_RESPONSE);
  });

  it('emits the raw export payload', async () => {
    const spy = captureStdout();
    const payload = { data: { sent_to_email: 'me@example.com', jid: 'job-9' } };
    MockMarketingApiClient.prototype.exportSubscribersCsv = jest.fn().mockResolvedValue(payload);

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'marketing', 'subscribers', 'export-csv',
      '--email', 'me@example.com',
    ]);

    expect(JSON.parse(joined(spy))).toEqual(payload);
  });

  it('emits the raw unsubscribe payload', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.unsubscribe = jest.fn().mockResolvedValue({ data: [] });

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'marketing', 'subscriptions', 'unsubscribe',
      '--subscriber-id', 'a', '--yes',
    ]);

    expect(JSON.parse(joined(spy))).toEqual({ data: [] });
  });

  it('emits the raw subscription-list create payload', async () => {
    const spy = captureStdout();
    const payload = { data: { id: '7', type: 'subscription_list', attributes: { name: 'VIPs', subscriber_count: 0 } } };
    MockMarketingApiClient.prototype.createSubscriptionList = jest.fn().mockResolvedValue(payload);

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'marketing', 'subscription-lists', 'create', '--name', 'VIPs',
    ]);

    expect(JSON.parse(joined(spy))).toEqual(payload);
  });
});

describe('paubox marketing dynamic-lists rendering', () => {
  const DYNAMIC_LISTS = {
    data: [
      {
        id: 'dyn-1',
        type: 'dynamic_list',
        attributes: { name: 'Recent signups', subscriber_count: 4, filters: '[]' },
      },
    ],
  };

  it('prints a table of dynamic lists', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.listDynamicLists = jest
      .fn()
      .mockResolvedValue(DYNAMIC_LISTS);

    await createProgram().parseAsync(['node', 'paubox', 'marketing', 'dynamic-lists', 'list']);

    const out = joined(spy);
    expect(out).toContain('Recent signups');
    expect(out).toContain('1 list(s)');
  });

  it('emits raw JSON for the dynamic list index', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.listDynamicLists = jest
      .fn()
      .mockResolvedValue(DYNAMIC_LISTS);

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'marketing', 'dynamic-lists', 'list',
    ]);

    expect(JSON.parse(joined(spy))).toEqual(DYNAMIC_LISTS);
  });

  it('prints dynamic list detail including filters', async () => {
    const spy = captureStdout();
    MockMarketingApiClient.prototype.getDynamicList = jest
      .fn()
      .mockResolvedValue({ data: DYNAMIC_LISTS.data[0] });

    await createProgram().parseAsync([
      'node', 'paubox', 'marketing', 'dynamic-lists', 'get', 'dyn-1',
    ]);

    const out = joined(spy);
    expect(out).toContain('Recent signups');
    expect(out).toContain('Filters:');
  });

  it('errors when a dynamic list is missing', async () => {
    captureStdout();
    MockMarketingApiClient.prototype.getDynamicList = jest.fn().mockResolvedValue({ data: null });

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'dynamic-lists', 'get', 'nope',
      ]),
    ).rejects.toThrow(/Dynamic list "nope" not found/);
  });

  it('reads filters from a file', async () => {
    captureStdout();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-marketing-'));
    const file = path.join(dir, 'filters.json');
    fs.writeFileSync(file, '[[{"field":"email","op":"contains","terms":["@example.com"]}]]');
    MockMarketingApiClient.prototype.createDynamicList = jest
      .fn()
      .mockResolvedValue({ data: DYNAMIC_LISTS.data[0] });

    try {
      await createProgram().parseAsync([
        'node', 'paubox', 'marketing', 'dynamic-lists', 'create',
        '--name', 'Recent', '--filters-file', file,
      ]);

      expect(MockMarketingApiClient.prototype.createDynamicList).toHaveBeenCalledWith({
        name: 'Recent',
        filters: '[[{"field":"email","op":"contains","terms":["@example.com"]}]]',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a filters file that is not valid JSON', async () => {
    captureStdout();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-marketing-'));
    const file = path.join(dir, 'filters.json');
    fs.writeFileSync(file, 'nope');

    try {
      await expect(
        createProgram().parseAsync([
          'node', 'paubox', 'marketing', 'dynamic-lists', 'create',
          '--name', 'Recent', '--filters-file', file,
        ]),
      ).rejects.toThrow(/Filters must be valid JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
