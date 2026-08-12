import {
  DEFAULT_FORMS_BASE_URL,
  FormsApiClient,
  resolveFormsBaseUrl,
} from '../../src/lib/forms-api';
import { ConfigError } from '../../src/lib/errors';

function makeFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  });
}

const FORM_ID = 'abc123';
const UUID = '11111111-2222-3333-4444-555555555555';

describe('resolveFormsBaseUrl', () => {
  it('returns the production default when unset', () => {
    expect(resolveFormsBaseUrl({})).toBe(DEFAULT_FORMS_BASE_URL);
  });

  it('treats an empty or whitespace-only override as unset', () => {
    expect(resolveFormsBaseUrl({ PAUBOX_FORMS_URL: '' })).toBe(DEFAULT_FORMS_BASE_URL);
    expect(resolveFormsBaseUrl({ PAUBOX_FORMS_URL: '   ' })).toBe(DEFAULT_FORMS_BASE_URL);
  });

  it('returns the override when set', () => {
    expect(resolveFormsBaseUrl({ PAUBOX_FORMS_URL: 'https://api.staging.paubox.net/forms' })).toBe(
      'https://api.staging.paubox.net/forms',
    );
  });

  it('strips trailing slashes so path joining does not double up', () => {
    expect(resolveFormsBaseUrl({ PAUBOX_FORMS_URL: 'https://staging.example.com/forms///' })).toBe(
      'https://staging.example.com/forms',
    );
  });

  it('allows http for local development', () => {
    expect(resolveFormsBaseUrl({ PAUBOX_FORMS_URL: 'http://localhost:3000/forms' })).toBe(
      'http://localhost:3000/forms',
    );
  });

  it('throws ConfigError when the override is not a valid URL', () => {
    expect(() => resolveFormsBaseUrl({ PAUBOX_FORMS_URL: 'staging.example.com' })).toThrow(
      ConfigError,
    );
  });

  it('throws ConfigError for a non-http scheme', () => {
    expect(() => resolveFormsBaseUrl({ PAUBOX_FORMS_URL: 'file:///etc/passwd' })).toThrow(
      /must use http or https/,
    );
  });
});

describe('FormsApiClient base URL', () => {
  const original = process.env.PAUBOX_FORMS_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PAUBOX_FORMS_URL;
    } else {
      process.env.PAUBOX_FORMS_URL = original;
    }
  });

  it('targets production when no override is set', async () => {
    delete process.env.PAUBOX_FORMS_URL;
    const mockFetch = makeFetch(200, {});
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.getForm(FORM_ID);
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_FORMS_BASE_URL}/public/form_data/${FORM_ID}`,
    );
  });

  it('routes public requests to the override', async () => {
    process.env.PAUBOX_FORMS_URL = 'https://staging.example.com/forms';
    const mockFetch = makeFetch(200, {});
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.getForm(FORM_ID);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://staging.example.com/forms/public/form_data/${FORM_ID}`,
    );
  });

  it('routes authenticated requests to the override and still sends the Bearer token', async () => {
    process.env.PAUBOX_FORMS_URL = 'https://staging.example.com/forms';
    const mockFetch = makeFetch(200, { data: [] });
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch, 'test-key');
    await client.listSubmissions(UUID, {});
    expect(mockFetch).toHaveBeenCalledWith(
      `https://staging.example.com/forms/api/forms/${UUID}/submissions`,
      { headers: { Authorization: 'Bearer test-key' } },
    );
  });

  it('prefers an explicit constructor base URL over the environment', async () => {
    process.env.PAUBOX_FORMS_URL = 'https://staging.example.com/forms';
    const mockFetch = makeFetch(200, {});
    const client = new FormsApiClient(
      mockFetch as unknown as typeof fetch,
      null,
      'https://explicit.example.com/forms',
    );
    await client.getForm(FORM_ID);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://explicit.example.com/forms/public/form_data/${FORM_ID}`,
    );
  });

  it('surfaces an invalid override when the client is constructed', () => {
    process.env.PAUBOX_FORMS_URL = 'not a url';
    expect(() => new FormsApiClient(makeFetch(200, {}) as unknown as typeof fetch)).toThrow(
      ConfigError,
    );
  });
});
