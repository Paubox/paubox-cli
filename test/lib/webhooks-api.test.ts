import {
  DEFAULT_WEBHOOKS_BASE_URL,
  WebhooksApiClient,
  resolveWebhooksBaseUrl,
} from '../../src/lib/webhooks-api';
import { ApiError, AuthError, ConfigError } from '../../src/lib/errors';

function makeFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  });
}

const KEY = 'forms-key-123';
const ID = '11111111-2222-3333-4444-555555555555';
const BASE = DEFAULT_WEBHOOKS_BASE_URL;
const AUTH = { Authorization: `Bearer ${KEY}` };

const SUBSCRIPTION = {
  id: ID,
  target_url: 'https://hooks.example.com/paubox',
  status: 'active',
  events: ['forms.submission.created'],
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-01T00:00:00+00:00',
};

function client(mockFetch: jest.Mock, apiKey: string | null = KEY): WebhooksApiClient {
  return new WebhooksApiClient(mockFetch as unknown as typeof fetch, apiKey);
}

describe('resolveWebhooksBaseUrl', () => {
  it('returns the production default when unset', () => {
    expect(resolveWebhooksBaseUrl({})).toBe(DEFAULT_WEBHOOKS_BASE_URL);
  });

  it('treats an empty or whitespace-only override as unset', () => {
    expect(resolveWebhooksBaseUrl({ PAUBOX_WEBHOOKS_URL: '' })).toBe(DEFAULT_WEBHOOKS_BASE_URL);
    expect(resolveWebhooksBaseUrl({ PAUBOX_WEBHOOKS_URL: '  ' })).toBe(DEFAULT_WEBHOOKS_BASE_URL);
  });

  it('returns the override when set', () => {
    expect(
      resolveWebhooksBaseUrl({ PAUBOX_WEBHOOKS_URL: 'https://api.staging.paubox.net/v1/webhooks' }),
    ).toBe('https://api.staging.paubox.net/v1/webhooks');
  });

  it('strips trailing slashes so path joining does not double up', () => {
    expect(resolveWebhooksBaseUrl({ PAUBOX_WEBHOOKS_URL: 'https://x.example.com/v1/webhooks//' })).toBe(
      'https://x.example.com/v1/webhooks',
    );
  });

  it('allows http for local development', () => {
    expect(resolveWebhooksBaseUrl({ PAUBOX_WEBHOOKS_URL: 'http://localhost:3000/v1' })).toBe(
      'http://localhost:3000/v1',
    );
  });

  it('throws ConfigError when the override is not a valid URL', () => {
    expect(() => resolveWebhooksBaseUrl({ PAUBOX_WEBHOOKS_URL: 'staging.example.com' })).toThrow(
      ConfigError,
    );
  });

  it('throws ConfigError for a non-http scheme', () => {
    expect(() => resolveWebhooksBaseUrl({ PAUBOX_WEBHOOKS_URL: 'file:///etc/passwd' })).toThrow(
      /must use http or https/,
    );
  });
});

describe('WebhooksApiClient base URL', () => {
  const original = process.env.PAUBOX_WEBHOOKS_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PAUBOX_WEBHOOKS_URL;
    } else {
      process.env.PAUBOX_WEBHOOKS_URL = original;
    }
  });

  it('routes requests to the environment override', async () => {
    process.env.PAUBOX_WEBHOOKS_URL = 'https://api.staging.paubox.net/v1/webhooks';
    const mockFetch = makeFetch(200, { data: [], page_info: { count: 0, items: 50 } });
    await client(mockFetch).listSubscriptions();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.staging.paubox.net/v1/webhooks/endpoints',
      { headers: AUTH },
    );
  });

  it('prefers an explicit constructor base URL over the environment', async () => {
    process.env.PAUBOX_WEBHOOKS_URL = 'https://api.staging.paubox.net/v1/webhooks';
    const mockFetch = makeFetch(200, { data: [], page_info: { count: 0, items: 50 } });
    const explicit = new WebhooksApiClient(
      mockFetch as unknown as typeof fetch,
      KEY,
      'https://explicit.example.com/v1/webhooks',
    );
    await explicit.listSubscriptions();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://explicit.example.com/v1/webhooks/endpoints',
      { headers: AUTH },
    );
  });

  it('surfaces an invalid override when the client is constructed', () => {
    process.env.PAUBOX_WEBHOOKS_URL = 'not a url';
    expect(() => new WebhooksApiClient(makeFetch(200, {}) as unknown as typeof fetch)).toThrow(
      ConfigError,
    );
  });
});

describe('WebhooksApiClient.listSubscriptions', () => {
  const LIST = { data: [SUBSCRIPTION], page_info: { count: 1, items: 50 } };

  it('calls the endpoints collection with the Bearer key', async () => {
    const mockFetch = makeFetch(200, LIST);
    const result = await client(mockFetch).listSubscriptions();
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/endpoints`, { headers: AUTH });
    expect(result).toEqual(LIST);
  });

  it('serializes pagination into the query string', async () => {
    const mockFetch = makeFetch(200, LIST);
    await client(mockFetch).listSubscriptions({ page: 2, items: 10 });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/endpoints?page=2&items=10`, {
      headers: AUTH,
    });
  });

  it('throws AuthError before making a request when no key is configured', async () => {
    const mockFetch = makeFetch(200, LIST);
    await expect(client(mockFetch, null).listSubscriptions()).rejects.toThrow(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('WebhooksApiClient.getSubscription', () => {
  it('unwraps the data envelope', async () => {
    const mockFetch = makeFetch(200, { data: SUBSCRIPTION });
    const result = await client(mockFetch).getSubscription(ID);
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/endpoints/${ID}`, { headers: AUTH });
    expect(result).toEqual(SUBSCRIPTION);
  });

  it('rejects a non-UUID id without making a request', async () => {
    const mockFetch = makeFetch(200, { data: SUBSCRIPTION });
    await expect(client(mockFetch).getSubscription('../endpoints')).rejects.toThrow(ConfigError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('WebhooksApiClient.createSubscription', () => {
  const CREATED = { data: { ...SUBSCRIPTION, signing_secret: 'whsec_abc' }, message: 'Store it' };
  const body = {
    target_url: 'https://hooks.example.com/paubox',
    events: ['forms.submission.created'],
  };

  it('POSTs the subscription and returns the created record', async () => {
    const mockFetch = makeFetch(201, CREATED);
    const result = await client(mockFetch).createSubscription(body);
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/endpoints`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(result).toEqual(CREATED.data);
  });

  it('returns the signing secret, which the service never repeats', async () => {
    const mockFetch = makeFetch(201, CREATED);
    const result = await client(mockFetch).createSubscription(body);
    expect(result.signing_secret).toBe('whsec_abc');
  });
});

describe('WebhooksApiClient.updateSubscription', () => {
  it('PATCHes only the provided fields', async () => {
    const mockFetch = makeFetch(200, { data: { ...SUBSCRIPTION, status: 'disabled' } });
    const result = await client(mockFetch).updateSubscription(ID, { status: 'disabled' });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/endpoints/${ID}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(result.status).toBe('disabled');
  });
});

describe('WebhooksApiClient.deleteSubscription', () => {
  it('DELETEs and resolves on 204', async () => {
    const mockFetch = makeFetch(204, '');
    await expect(client(mockFetch).deleteSubscription(ID)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/endpoints/${ID}`, {
      method: 'DELETE',
      headers: AUTH,
    });
  });
});

describe('WebhooksApiClient error mapping', () => {
  it('maps 401 to AuthError naming the forms scope', async () => {
    const mockFetch = makeFetch(401, '');
    await expect(client(mockFetch).listSubscriptions()).rejects.toThrow(/forms/);
    await expect(client(mockFetch).listSubscriptions()).rejects.toThrow(AuthError);
  });

  it('maps 403 to ApiError and unwraps the service message', async () => {
    const mockFetch = makeFetch(403, { message: 'events: not entitled to \'email.inbound.received\'' });
    await expect(client(mockFetch).listSubscriptions()).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('not entitled'),
    });
  });

  it('maps 404 to ApiError', async () => {
    const mockFetch = makeFetch(404, { message: 'webhook endpoint not found' });
    await expect(client(mockFetch).getSubscription(ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('maps 422 to ApiError carrying the validation detail', async () => {
    const mockFetch = makeFetch(422, { message: 'target_url: must be an https URL' });
    await expect(
      client(mockFetch).createSubscription({ target_url: 'http://x.example.com', events: [] }),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('must be an https URL'),
    });
  });

  it('falls back to the raw body when the error is not the usual JSON shape', async () => {
    const mockFetch = makeFetch(500, 'Route does not exist.');
    await expect(client(mockFetch).listSubscriptions()).rejects.toThrow(/Route does not exist/);
    await expect(client(mockFetch).listSubscriptions()).rejects.toBeInstanceOf(ApiError);
  });
});
