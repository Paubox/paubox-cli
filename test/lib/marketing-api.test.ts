import {
  DEFAULT_MARKETING_BASE_URL,
  MarketingApiClient,
  resolveMarketingBaseUrl,
} from '../../src/lib/marketing-api';
import { ApiError, AuthError, ConfigError } from '../../src/lib/errors';

function makeFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  });
}

const KEY = 'test-key';
const AUTH = { headers: { Authorization: `Bearer ${KEY}` } };

function client(mockFetch: jest.Mock, apiKey: string | null = KEY): MarketingApiClient {
  return new MarketingApiClient(mockFetch as unknown as typeof fetch, apiKey);
}

const SUBSCRIBER = {
  id: 'sub-uuid-1',
  type: 'subscriber',
  attributes: {
    email: 'jane@example.com',
    phone_number: null,
    first_name: 'Jane',
    last_name: 'Doe',
    full_name: 'Jane Doe',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
};

describe('resolveMarketingBaseUrl', () => {
  it('returns the production gateway when unset', () => {
    expect(resolveMarketingBaseUrl({})).toBe(DEFAULT_MARKETING_BASE_URL);
    expect(DEFAULT_MARKETING_BASE_URL).toBe('https://api.paubox.com/v1/marketing');
  });

  it('treats an empty or whitespace-only override as unset', () => {
    expect(resolveMarketingBaseUrl({ PAUBOX_MARKETING_URL: '' })).toBe(DEFAULT_MARKETING_BASE_URL);
    expect(resolveMarketingBaseUrl({ PAUBOX_MARKETING_URL: '  ' })).toBe(
      DEFAULT_MARKETING_BASE_URL,
    );
  });

  it('strips trailing slashes so path joining does not double up', () => {
    expect(
      resolveMarketingBaseUrl({ PAUBOX_MARKETING_URL: 'https://staging.example.com/v1/marketing//' }),
    ).toBe('https://staging.example.com/v1/marketing');
  });

  it('allows http for local development', () => {
    expect(resolveMarketingBaseUrl({ PAUBOX_MARKETING_URL: 'http://localhost:3000/v1/marketing' })).toBe(
      'http://localhost:3000/v1/marketing',
    );
  });

  it('throws ConfigError when the override is not a valid URL', () => {
    expect(() => resolveMarketingBaseUrl({ PAUBOX_MARKETING_URL: 'staging.example.com' })).toThrow(
      ConfigError,
    );
  });

  it('throws ConfigError for a non-http scheme', () => {
    expect(() => resolveMarketingBaseUrl({ PAUBOX_MARKETING_URL: 'file:///etc/passwd' })).toThrow(
      /must use http or https/,
    );
  });
});

describe('MarketingApiClient auth', () => {
  it('sends the API key as a Bearer token', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).listBulkJobs();
    expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_MARKETING_BASE_URL}/bulk_jobs`, AUTH);
  });

  it('throws AuthError when no API key is configured', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await expect(client(mockFetch, null).listBulkJobs()).rejects.toThrow(AuthError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps 401 to AuthError', async () => {
    const mockFetch = makeFetch(401, { errors: [{ message: '401 Unauthorized' }] });
    await expect(client(mockFetch).listBulkJobs()).rejects.toThrow(AuthError);
  });

  it('maps 403 to ApiError', async () => {
    const mockFetch = makeFetch(403, { errors: [{ message: '403 Forbidden' }] });
    await expect(client(mockFetch).listBulkJobs()).rejects.toThrow(ApiError);
  });

  it('explains a 404 caused by the account having no marketing customer', async () => {
    const mockFetch = makeFetch(404, { errors: [{ message: '404 Customer Not Found' }] });
    await expect(client(mockFetch).listBulkJobs()).rejects.toThrow(
      /No Paubox Marketing account is associated/,
    );
  });

  it('reports an ordinary 404 as a missing resource', async () => {
    const mockFetch = makeFetch(404, { errors: [{ message: '404 Not Found' }] });
    await expect(client(mockFetch).getBulkJob('bid-1')).rejects.toThrow(/Resource not found/);
  });

  it('surfaces other failures with the status and body', async () => {
    const mockFetch = makeFetch(500, 'boom');
    await expect(client(mockFetch).listBulkJobs()).rejects.toThrow(/Request failed \(500\): boom/);
  });
});

describe('MarketingApiClient.listSubscribers', () => {
  it('returns the parsed collection', async () => {
    const body = { data: [SUBSCRIBER], total_count: 1, search_after: [123] };
    const mockFetch = makeFetch(200, body);
    await expect(client(mockFetch).listSubscribers({})).resolves.toEqual(body);
  });

  it('sends no query string when no filters are given', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).listSubscribers({});
    expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_MARKETING_BASE_URL}/subscribers`, AUTH);
  });

  it('maps camelCase params onto the snake_case query', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).listSubscribers({
      search: 'jane',
      orderBy: 'created_at',
      order: 'desc',
      page: 2,
      items: 25,
      subscriptionListId: 'list-1',
      dynamicListId: 'dyn-1',
    });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'jane',
      order_by: 'created_at',
      order: 'desc',
      page: '2',
      items: '25',
      subscription_list_id: 'list-1',
      dynamic_list_id: 'dyn-1',
    });
  });
});

describe('MarketingApiClient.getSubscriber', () => {
  it('requests the subscriber by ID', async () => {
    const mockFetch = makeFetch(200, { data: SUBSCRIBER });
    await client(mockFetch).getSubscriber('sub-uuid-1');
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_MARKETING_BASE_URL}/subscribers/sub-uuid-1`,
      AUTH,
    );
  });

  it('URL-encodes the subscriber ID', async () => {
    const mockFetch = makeFetch(200, { data: null });
    await client(mockFetch).getSubscriber('id/with spaces');
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_MARKETING_BASE_URL}/subscribers/id%2Fwith%20spaces`,
      AUTH,
    );
  });

  it('rejects path-traversal segments', async () => {
    const mockFetch = makeFetch(200, { data: null });
    await expect(client(mockFetch).getSubscriber('..')).rejects.toThrow(ConfigError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends with_stats as the string "true" the serializer expects', async () => {
    const mockFetch = makeFetch(200, { data: SUBSCRIBER });
    await client(mockFetch).getSubscriber('sub-uuid-1', { withStats: true });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('with_stats')).toBe('true');
  });

  it('omits with_stats entirely when not requested', async () => {
    const mockFetch = makeFetch(200, { data: SUBSCRIBER });
    await client(mockFetch).getSubscriber('sub-uuid-1', { withStats: false });
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_MARKETING_BASE_URL}/subscribers/sub-uuid-1`,
      AUTH,
    );
  });
});

describe('MarketingApiClient.getSubscribedCount', () => {
  it('returns the count payload', async () => {
    const mockFetch = makeFetch(200, { data: 42 });
    await expect(client(mockFetch).getSubscribedCount()).resolves.toEqual({ data: 42 });
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_MARKETING_BASE_URL}/subscribers/subscribed_count`,
      AUTH,
    );
  });

  it('passes the subscription list filter', async () => {
    const mockFetch = makeFetch(200, { data: 7 });
    await client(mockFetch).getSubscribedCount({ subscriptionListId: 'list-9' });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('subscription_list_id')).toBe('list-9');
  });
});

describe('MarketingApiClient.listLists', () => {
  it('does not opt into pagination when no page or items is given', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).listLists({});
    expect(mockFetch).toHaveBeenCalledWith(`${DEFAULT_MARKETING_BASE_URL}/lists`, AUTH);
  });

  it('opts into pagination when a page is requested', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).listLists({ page: 2 });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('use_pagination')).toBe('true');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('opts into pagination when only items is requested', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).listLists({ items: 50 });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('use_pagination')).toBe('true');
  });
});

describe('MarketingApiClient.listCampaigns', () => {
  it('maps filters onto the query', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).listCampaigns({
      search: 'newsletter',
      orderBy: 'created_at',
      order: 'asc',
      page: 3,
      templateType: 'drip',
    });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'newsletter',
      order_by: 'created_at',
      order: 'asc',
      page: '3',
      template_type: 'drip',
    });
  });
});

describe('MarketingApiClient.getCampaign', () => {
  it('omits with_images unless requested, since the server checks presence', async () => {
    const mockFetch = makeFetch(200, { data: null });
    await client(mockFetch).getCampaign('42', { withImages: false });
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_MARKETING_BASE_URL}/campaign_mailings/42`,
      AUTH,
    );
  });

  it('sends with_images when requested', async () => {
    const mockFetch = makeFetch(200, { data: null });
    await client(mockFetch).getCampaign('42', { withImages: true });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('with_images')).toBe('true');
  });
});

describe('MarketingApiClient.getAnalytics', () => {
  it('builds the report path from the type', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).getAnalytics('campaign_mailing_send_totals');
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_MARKETING_BASE_URL}/analytics/campaign_mailing_send_totals`,
      AUTH,
    );
  });

  it('maps report params onto the query', async () => {
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).getAnalytics('campaign_mailing_sends_table', {
      dripCampaignId: 'drip-1',
      emailType: 'blast',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      byDate: true,
      dateOffset: 30,
      withStats: true,
      order: 'asc',
      orderBy: 'sent_at',
    });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      drip_campaign_id: 'drip-1',
      email_type: 'blast',
      start_date: '2026-01-01',
      end_date: '2026-02-01',
      by_date: 'true',
      date_offset: '30',
      with_stats: 'true',
      order: 'asc',
      order_by: 'sent_at',
    });
  });
});

describe('MarketingApiClient bulk jobs', () => {
  it('lists jobs', async () => {
    const body = { data: [{ total_jobs: 5, failures: 0, pending: 2 }] };
    const mockFetch = makeFetch(200, body);
    await expect(client(mockFetch).listBulkJobs()).resolves.toEqual(body);
  });

  it('gets a job by batch ID', async () => {
    const mockFetch = makeFetch(200, { data: { total_jobs: 1, failures: 0, pending: 0 } });
    await client(mockFetch).getBulkJob('bid-123');
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_MARKETING_BASE_URL}/bulk_jobs/bid-123`,
      AUTH,
    );
  });
});

describe('MarketingApiClient base URL override', () => {
  const original = process.env.PAUBOX_MARKETING_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PAUBOX_MARKETING_URL;
    } else {
      process.env.PAUBOX_MARKETING_URL = original;
    }
  });

  it('routes requests to the override', async () => {
    process.env.PAUBOX_MARKETING_URL = 'https://staging.example.com/v1/marketing';
    const mockFetch = makeFetch(200, { data: [] });
    await client(mockFetch).listBulkJobs();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://staging.example.com/v1/marketing/bulk_jobs',
      AUTH,
    );
  });

  it('prefers an explicit constructor base URL over the environment', async () => {
    process.env.PAUBOX_MARKETING_URL = 'https://staging.example.com/v1/marketing';
    const mockFetch = makeFetch(200, { data: [] });
    const explicit = new MarketingApiClient(
      mockFetch as unknown as typeof fetch,
      KEY,
      'https://explicit.example.com/v1/marketing',
    );
    await explicit.listBulkJobs();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://explicit.example.com/v1/marketing/bulk_jobs',
      AUTH,
    );
  });

  it('surfaces an invalid override when the client is constructed', () => {
    process.env.PAUBOX_MARKETING_URL = 'not a url';
    expect(() => new MarketingApiClient(makeFetch(200, {}) as unknown as typeof fetch)).toThrow(
      ConfigError,
    );
  });
});
