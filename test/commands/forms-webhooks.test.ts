import { createProgram } from '../../src/index';
import { WebhooksApiClient } from '../../src/lib/webhooks-api';
import * as credentials from '../../src/lib/credentials';
import { ConfigError } from '../../src/lib/errors';

jest.mock('../../src/lib/webhooks-api', () => {
  const actual = jest.requireActual('../../src/lib/webhooks-api');
  return { ...actual, WebhooksApiClient: jest.fn() };
});
jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/api', () => ({
  PauboxApiClient: jest.fn(),
  resolveAttachments: jest.fn(),
}));

const MockWebhooksApiClient = WebhooksApiClient as jest.MockedClass<typeof WebhooksApiClient>;
const mockLoadCredentials = credentials.loadCredentials as jest.Mock;

const CREDS = { apiKey: 'key', formsApiKey: 'forms-key-123' };
const ID = '11111111-2222-3333-4444-555555555555';

const SUBSCRIPTION = {
  id: ID,
  target_url: 'https://hooks.example.com/paubox',
  status: 'active',
  events: ['forms.submission.created'],
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-01T00:00:00+00:00',
};

function captureStdout(): jest.SpyInstance {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

function joined(spy: jest.SpyInstance): string {
  return spy.mock.calls.map((c) => c[0]).join('');
}

function run(...args: string[]): Promise<unknown> {
  return createProgram().parseAsync(['node', 'paubox', 'forms', 'webhooks', ...args]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadCredentials.mockResolvedValue(CREDS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('paubox forms webhooks list', () => {
  const LIST = { data: [SUBSCRIPTION], page_info: { count: 1, items: 50 } };

  beforeEach(() => {
    MockWebhooksApiClient.prototype.listSubscriptions = jest.fn().mockResolvedValue(LIST);
  });

  it('constructs the client with the stored Forms API key', async () => {
    captureStdout();
    await run('list');
    expect(MockWebhooksApiClient).toHaveBeenCalledWith(undefined, 'forms-key-123');
  });

  it('passes parsed pagination through', async () => {
    captureStdout();
    await run('list', '--page', '2', '--items', '10');
    expect(MockWebhooksApiClient.prototype.listSubscriptions).toHaveBeenCalledWith({
      page: 2,
      items: 10,
    });
  });

  it('rejects a non-integer --page', async () => {
    captureStdout();
    await expect(run('list', '--page', 'two')).rejects.toThrow(ConfigError);
  });

  it('prints a table of subscriptions', async () => {
    const out = captureStdout();
    await run('list');
    expect(joined(out)).toContain(ID);
    expect(joined(out)).toContain('forms.submission.created');
  });

  it('says so when there is nothing subscribed', async () => {
    MockWebhooksApiClient.prototype.listSubscriptions = jest
      .fn()
      .mockResolvedValue({ data: [], page_info: { count: 0, items: 50 } });
    const out = captureStdout();
    await run('list');
    expect(joined(out)).toContain('No webhook subscriptions found.');
  });

  it('prints the raw response with --json', async () => {
    const out = captureStdout();
    await createProgram().parseAsync(['node', 'paubox', '--json', 'forms', 'webhooks', 'list']);
    expect(JSON.parse(joined(out))).toEqual(LIST);
  });
});

describe('paubox forms webhooks create', () => {
  const CREATED = { ...SUBSCRIPTION, signing_secret: 'whsec_abc123' };

  beforeEach(() => {
    MockWebhooksApiClient.prototype.createSubscription = jest.fn().mockResolvedValue(CREATED);
  });

  it('defaults to the only event an API key can subscribe to', async () => {
    captureStdout();
    await run('create', '--url', 'https://hooks.example.com/paubox');
    expect(MockWebhooksApiClient.prototype.createSubscription).toHaveBeenCalledWith({
      target_url: 'https://hooks.example.com/paubox',
      events: ['forms.submission.created'],
    });
  });

  it('accepts an explicit event list', async () => {
    captureStdout();
    await run(
      'create',
      '--url',
      'https://hooks.example.com/paubox',
      '--events',
      'forms.submission.created',
    );
    expect(MockWebhooksApiClient.prototype.createSubscription).toHaveBeenCalledWith({
      target_url: 'https://hooks.example.com/paubox',
      events: ['forms.submission.created'],
    });
  });

  it('prints the signing secret and warns that it is shown once', async () => {
    const out = captureStdout();
    await run('create', '--url', 'https://hooks.example.com/paubox');
    expect(joined(out)).toContain('whsec_abc123');
    expect(joined(out)).toContain('not shown again');
  });

  it('includes the signing secret in --json output', async () => {
    const out = captureStdout();
    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'webhooks', 'create',
      '--url', 'https://hooks.example.com/paubox',
    ]);
    expect(JSON.parse(joined(out))).toEqual(CREATED);
  });
});

describe('paubox forms webhooks get', () => {
  beforeEach(() => {
    MockWebhooksApiClient.prototype.getSubscription = jest.fn().mockResolvedValue(SUBSCRIPTION);
  });

  it('prints the subscription detail', async () => {
    const out = captureStdout();
    await run('get', ID);
    expect(MockWebhooksApiClient.prototype.getSubscription).toHaveBeenCalledWith(ID);
    expect(joined(out)).toContain('https://hooks.example.com/paubox');
  });
});

describe('paubox forms webhooks update', () => {
  beforeEach(() => {
    MockWebhooksApiClient.prototype.updateSubscription = jest
      .fn()
      .mockResolvedValue({ ...SUBSCRIPTION, status: 'disabled' });
  });

  it('sends only the fields that were passed', async () => {
    captureStdout();
    await run('update', ID, '--status', 'disabled');
    expect(MockWebhooksApiClient.prototype.updateSubscription).toHaveBeenCalledWith(ID, {
      status: 'disabled',
    });
  });

  it('sends a replacement url and event list together', async () => {
    captureStdout();
    await run('update', ID, '--url', 'https://new.example.com/hook', '--events', 'forms.submission.created');
    expect(MockWebhooksApiClient.prototype.updateSubscription).toHaveBeenCalledWith(ID, {
      target_url: 'https://new.example.com/hook',
      events: ['forms.submission.created'],
    });
  });

  it('rejects a status the service does not accept', async () => {
    captureStdout();
    await expect(run('update', ID, '--status', 'paused')).rejects.toThrow(/active, disabled/);
  });

  it('refuses an update with nothing to change', async () => {
    captureStdout();
    await expect(run('update', ID)).rejects.toThrow(/No update options provided/);
    expect(MockWebhooksApiClient.prototype.updateSubscription).not.toHaveBeenCalled();
  });
});

describe('paubox forms webhooks delete', () => {
  beforeEach(() => {
    MockWebhooksApiClient.prototype.deleteSubscription = jest.fn().mockResolvedValue(undefined);
  });

  it('deletes and confirms', async () => {
    const out = captureStdout();
    await run('delete', ID);
    expect(MockWebhooksApiClient.prototype.deleteSubscription).toHaveBeenCalledWith(ID);
    expect(joined(out)).toContain('deleted');
  });

  it('reports the deleted id with --json', async () => {
    const out = captureStdout();
    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'webhooks', 'delete', ID,
    ]);
    expect(JSON.parse(joined(out))).toEqual({ status: 'ok', subscriptionId: ID });
  });
});
