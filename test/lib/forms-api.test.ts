import { FormsApiClient } from '../../src/lib/forms-api';
import { ApiError, AuthError } from '../../src/lib/errors';

function makeFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  });
}

const FORM_ID = 'abc123';
const FORM_RESPONSE = {
  id: 'abc123',
  title: 'Test Form',
  description: 'A test form',
  active: true,
  submission_count: 5,
  signable: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

describe('FormsApiClient.getForm', () => {
  it('returns parsed form data on 200', async () => {
    const mockFetch = makeFetch(200, FORM_RESPONSE);
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    const result = await client.getForm(FORM_ID);
    expect(result).toEqual(FORM_RESPONSE);
  });

  it('calls the correct URL', async () => {
    const mockFetch = makeFetch(200, FORM_RESPONSE);
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.getForm(FORM_ID);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://apx.paubox.com/forms/public/form_data/${FORM_ID}`,
    );
  });

  it('URL-encodes formId with special characters', async () => {
    const mockFetch = makeFetch(200, FORM_RESPONSE);
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.getForm('form/with spaces');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://apx.paubox.com/forms/public/form_data/form%2Fwith%20spaces',
    );
  });

  it('sends no Authorization header', async () => {
    const mockFetch = makeFetch(200, FORM_RESPONSE);
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.getForm(FORM_ID);
    const callArgs = mockFetch.mock.calls[0];
    // Called with only the URL (no options object), so no headers at all
    expect(callArgs).toHaveLength(1);
  });

  it('throws ApiError with statusCode 404 on 404 response', async () => {
    const mockFetch = makeFetch(404, 'not found');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await expect(client.getForm(FORM_ID)).rejects.toThrow(ApiError);
    await expect(client.getForm(FORM_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws ApiError on other non-ok responses', async () => {
    const mockFetch = makeFetch(500, 'internal error');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await expect(client.getForm(FORM_ID)).rejects.toThrow(ApiError);
    await expect(client.getForm(FORM_ID)).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('FormsApiClient.submitForm', () => {
  const payload = { form_data: { name: 'Jane', email: 'jane@example.com' } };

  it('calls the correct URL with POST and Content-Type header', async () => {
    const mockFetch = makeFetch(201, '');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.submitForm(FORM_ID, payload);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://apx.paubox.com/forms/api/forms/${FORM_ID}/submissions`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('serializes form_data into request body', async () => {
    const mockFetch = makeFetch(201, '');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.submitForm(FORM_ID, payload);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('serializes attachments when provided', async () => {
    const mockFetch = makeFetch(201, '');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    const withAttachments = {
      ...payload,
      attachments: [{ fileName: 'file.pdf', contentType: 'application/pdf', content: 'abc' }],
    };
    await client.submitForm(FORM_ID, withAttachments);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(withAttachments);
  });

  it('resolves without error on 201', async () => {
    const mockFetch = makeFetch(201, '');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await expect(client.submitForm(FORM_ID, payload)).resolves.toBeUndefined();
  });

  it('does not call response.json() on 201', async () => {
    const mockResponse = {
      ok: true,
      status: 201,
      text: jest.fn(),
      json: jest.fn(),
    };
    const mockFetch = jest.fn().mockResolvedValue(mockResponse);
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.submitForm(FORM_ID, payload);
    expect(mockResponse.json).not.toHaveBeenCalled();
  });

  it('throws ApiError with statusCode 404 on 404 response', async () => {
    const mockFetch = makeFetch(404, 'not found');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await expect(client.submitForm(FORM_ID, payload)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws ApiError with body text and suggestion on 422', async () => {
    const mockFetch = makeFetch(422, '{"error":"invalid field"}');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await expect(client.submitForm(FORM_ID, payload)).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(client.submitForm(FORM_ID, payload)).rejects.toThrow(
      'Submission validation failed',
    );
  });

  it('throws ApiError with 250 MB suggestion on 413', async () => {
    const mockFetch = makeFetch(413, '');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await expect(client.submitForm(FORM_ID, payload)).rejects.toMatchObject({
      statusCode: 413,
      suggestion: expect.stringContaining('250 MB'),
    });
  });

  it('throws ApiError on other non-ok responses', async () => {
    const mockFetch = makeFetch(500, 'server error');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await expect(client.submitForm(FORM_ID, payload)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('omits attachments key when none provided', async () => {
    const mockFetch = makeFetch(201, '');
    const client = new FormsApiClient(mockFetch as unknown as typeof fetch);
    await client.submitForm(FORM_ID, { form_data: { x: 'y' } });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty('attachments');
  });
});

// ---------------------------------------------------------------------------
// Authenticated endpoints
// ---------------------------------------------------------------------------

const API_KEY = 'pbx_scoped_key_123';
const BASE = 'https://apx.paubox.com/forms';
const FORM_UUID = '11111111-1111-4111-8111-111111111111';
const SUB_UUID = '22222222-2222-4222-8222-222222222222';

function makeAuthFetch(status: number, body: unknown, binary?: Buffer): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(
        binary
          ? binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength)
          : new ArrayBuffer(0),
      ),
  });
}

function makeClient(mockFetch: jest.Mock, apiKey: string | null = API_KEY): FormsApiClient {
  return new FormsApiClient(mockFetch as unknown as typeof fetch, apiKey);
}

const FORM_RECORD = {
  id: 'form-1',
  title: 'Intake',
  description: null,
  form_html: null,
  form_json: { fields: [] },
  form_css: null,
  vanity_url: null,
  version: 1,
  active: true,
  customer_id: 42,
  old_form_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  recipient: null,
  signable: false,
  signature_confirmation_label: null,
  submission_count: 3,
  type: null,
  subscription_list_id: null,
  deleted: false,
  archived: false,
};

const LIST_RESPONSE = {
  results: [FORM_RECORD],
  page_info: { count: 1, pages: 1, page: 1, items: 50 },
};

const STATS_RESPONSE = {
  active_form_count: 4,
  total_submission_count: 100,
  submissions_last_7_days: 7,
};

const SUBMISSION_RECORD = {
  id: 'sub-1',
  form_id: 'form-1',
  form_data: '{"name":"Jane"}',
  storage_type: null,
  storage_url: null,
  submitter_email: 'jane@example.com',
  recipients: null,
  attachment_name: null,
  attachment_url: null,
  attachment_type: null,
  created_at: '2026-02-01T00:00:00Z',
};

const SUBMISSION_LIST_RESPONSE = {
  data: [SUBMISSION_RECORD],
  total: 1,
  page: 1,
  items: 50,
};

describe('FormsApiClient.listForms', () => {
  it('calls GET /api/forms with all query params', async () => {
    const mockFetch = makeAuthFetch(200, LIST_RESPONSE);
    const client = makeClient(mockFetch);
    await client.listForms({
      customerId: 42,
      formId: 'form-1',
      search: 'intake form',
      archived: false,
      active: true,
      orderBy: 'updated_at',
      order: 'asc',
      page: 2,
      items: 25,
    });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(
      `${BASE}/api/forms?customer_id=42&form_id=form-1&search=intake+form&archived=false&active=true&order_by=updated_at&order=asc&page=2&items=25`,
    );
  });

  it('omits undefined params from the query string', async () => {
    const mockFetch = makeAuthFetch(200, LIST_RESPONSE);
    const client = makeClient(mockFetch);
    await client.listForms({ customerId: 42 });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(`${BASE}/api/forms?customer_id=42`);
  });

  it('sends the Bearer Authorization header', async () => {
    const mockFetch = makeAuthFetch(200, LIST_RESPONSE);
    const client = makeClient(mockFetch);
    await client.listForms({ customerId: 42 });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: `Bearer ${API_KEY}` });
  });

  it('returns the parsed list response', async () => {
    const mockFetch = makeAuthFetch(200, LIST_RESPONSE);
    const client = makeClient(mockFetch);
    await expect(client.listForms({ customerId: 42 })).resolves.toEqual(LIST_RESPONSE);
  });
});

describe('FormsApiClient.getFormStats', () => {
  it('calls GET /api/forms/stats without query when customerId omitted', async () => {
    const mockFetch = makeAuthFetch(200, STATS_RESPONSE);
    const client = makeClient(mockFetch);
    await client.getFormStats();
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/forms/stats`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
  });

  it('includes customer_id query param when provided', async () => {
    const mockFetch = makeAuthFetch(200, STATS_RESPONSE);
    const client = makeClient(mockFetch);
    await client.getFormStats(42);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(`${BASE}/api/forms/stats?customer_id=42`);
  });

  it('returns the parsed stats response', async () => {
    const mockFetch = makeAuthFetch(200, STATS_RESPONSE);
    const client = makeClient(mockFetch);
    await expect(client.getFormStats()).resolves.toEqual(STATS_RESPONSE);
  });
});

describe('FormsApiClient.getFormAdmin', () => {
  it('calls GET /api/forms/:id with Bearer header and a UUID id', async () => {
    const mockFetch = makeAuthFetch(200, { data: FORM_RECORD });
    const client = makeClient(mockFetch);
    await client.getFormAdmin(FORM_UUID);
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/forms/${FORM_UUID}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
  });

  it('unwraps the {data} envelope', async () => {
    const mockFetch = makeAuthFetch(200, { data: FORM_RECORD });
    const client = makeClient(mockFetch);
    await expect(client.getFormAdmin(FORM_UUID)).resolves.toEqual(FORM_RECORD);
  });
});

describe('FormsApiClient.createForm', () => {
  const createBody = {
    title: 'New Form',
    customer_id: 42,
    form_json: { fields: [{ name: 'email' }] },
    version: 1,
    description: 'desc',
    active: true,
  };

  it('POSTs to /api/forms with Bearer and Content-Type headers', async () => {
    const mockFetch = makeAuthFetch(200, { id: 'new-id' });
    const client = makeClient(mockFetch);
    await client.createForm(createBody);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/forms`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('serializes the create body as JSON', async () => {
    const mockFetch = makeAuthFetch(200, { id: 'new-id' });
    const client = makeClient(mockFetch);
    await client.createForm(createBody);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(createBody);
  });

  it('returns the {id} response', async () => {
    const mockFetch = makeAuthFetch(200, { id: 'new-id' });
    const client = makeClient(mockFetch);
    await expect(client.createForm(createBody)).resolves.toEqual({ id: 'new-id' });
  });
});

describe('FormsApiClient.updateForm', () => {
  it('PUTs to /api/forms/:id with only provided fields', async () => {
    const mockFetch = makeAuthFetch(200, { detail: 'Form updated successfully', form_id: FORM_UUID });
    const client = makeClient(mockFetch);
    await client.updateForm(FORM_UUID, { title: 'Renamed', active: false });
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/forms/${FORM_UUID}`,
      expect.objectContaining({
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }),
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Renamed', active: false });
  });

  it('resolves without a value on success', async () => {
    const mockFetch = makeAuthFetch(200, { detail: 'Form updated successfully', form_id: FORM_UUID });
    const client = makeClient(mockFetch);
    await expect(client.updateForm(FORM_UUID, { title: 'x' })).resolves.toBeUndefined();
  });

  it('maps 404 to ApiError with suggestion', async () => {
    const mockFetch = makeAuthFetch(404, 'not found');
    const client = makeClient(mockFetch);
    await expect(client.updateForm(FORM_UUID, { title: 'x' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Form or submission not found.',
      suggestion: 'Check the ID and try again.',
    });
  });
});

describe('FormsApiClient.archiveForm / unarchiveForm', () => {
  it('POSTs to /api/forms/:id/archive with Bearer header', async () => {
    const mockFetch = makeAuthFetch(200, { detail: 'Form archived.' });
    const client = makeClient(mockFetch);
    await expect(client.archiveForm(FORM_UUID)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/forms/${FORM_UUID}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
  });

  it('POSTs to /api/forms/:id/unarchive with Bearer header', async () => {
    const mockFetch = makeAuthFetch(200, { detail: 'Form unarchived.' });
    const client = makeClient(mockFetch);
    await expect(client.unarchiveForm(FORM_UUID)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/forms/${FORM_UUID}/unarchive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
  });
});

describe('FormsApiClient.copyForm', () => {
  it('POSTs { form_id, title } to /api/forms/copy', async () => {
    const mockFetch = makeAuthFetch(200, FORM_RECORD);
    const client = makeClient(mockFetch);
    await client.copyForm('form-1', 'Copied Title');
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/forms/copy`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }),
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ form_id: 'form-1', title: 'Copied Title' });
  });

  it('returns the new form record', async () => {
    const mockFetch = makeAuthFetch(200, FORM_RECORD);
    const client = makeClient(mockFetch);
    await expect(client.copyForm('form-1', 'Copied Title')).resolves.toEqual(FORM_RECORD);
  });
});

describe('FormsApiClient.listSubmissions', () => {
  it('calls GET /api/forms/:formId/submissions with all query params', async () => {
    const mockFetch = makeAuthFetch(200, SUBMISSION_LIST_RESPONSE);
    const client = makeClient(mockFetch);
    await client.listSubmissions(FORM_UUID, {
      page: 3,
      items: 10,
      orderBy: 'submitter_email',
      order: 'desc',
      submissionId: SUB_UUID,
    });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(
      `${BASE}/api/forms/${FORM_UUID}/submissions?page=3&items=10&order_by=submitter_email&order=desc&submission_id=${SUB_UUID}`,
    );
  });

  it('omits the query string entirely when no params given', async () => {
    const mockFetch = makeAuthFetch(200, SUBMISSION_LIST_RESPONSE);
    const client = makeClient(mockFetch);
    await client.listSubmissions(FORM_UUID, {});
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/forms/${FORM_UUID}/submissions`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
  });

  it('returns the parsed submission list response', async () => {
    const mockFetch = makeAuthFetch(200, SUBMISSION_LIST_RESPONSE);
    const client = makeClient(mockFetch);
    await expect(client.listSubmissions(FORM_UUID, {})).resolves.toEqual(
      SUBMISSION_LIST_RESPONSE,
    );
  });
});

describe('FormsApiClient.exportSubmissionsCsv', () => {
  it('calls the all-submissions CSV URL when submissionId is omitted', async () => {
    const mockFetch = makeAuthFetch(200, '', Buffer.from('a,b\n1,2\n'));
    const client = makeClient(mockFetch);
    await client.exportSubmissionsCsv(FORM_UUID);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/forms/${FORM_UUID}/submissions/submission-csv`,
      { headers: { Authorization: `Bearer ${API_KEY}` } },
    );
  });

  it('appends the submissionId segment when given', async () => {
    const mockFetch = makeAuthFetch(200, '', Buffer.from('a,b\n1,2\n'));
    const client = makeClient(mockFetch);
    await client.exportSubmissionsCsv(FORM_UUID, SUB_UUID);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(`${BASE}/api/forms/${FORM_UUID}/submissions/submission-csv/${SUB_UUID}`);
  });

  it('returns a Buffer of the response bytes', async () => {
    const csv = Buffer.from('a,b\n1,2\n');
    const mockFetch = makeAuthFetch(200, '', csv);
    const client = makeClient(mockFetch);
    const result = await client.exportSubmissionsCsv(FORM_UUID);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.equals(csv)).toBe(true);
  });

  it('treats any non-200 status as an error', async () => {
    const mockFetch = makeAuthFetch(204, '');
    const client = makeClient(mockFetch);
    await expect(client.exportSubmissionsCsv(FORM_UUID)).rejects.toThrow(ApiError);
  });
});

describe('FormsApiClient.exportSubmissionPdf', () => {
  it('calls the submission PDF URL with Bearer header and UUID segments', async () => {
    const mockFetch = makeAuthFetch(200, '', Buffer.from('%PDF-1.7'));
    const client = makeClient(mockFetch);
    await client.exportSubmissionPdf(FORM_UUID, SUB_UUID);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/forms/${FORM_UUID}/submissions/${SUB_UUID}/submission-pdf`,
      { headers: { Authorization: `Bearer ${API_KEY}` } },
    );
  });

  it('returns a Buffer of the PDF bytes', async () => {
    const pdf = Buffer.from('%PDF-1.7 fake pdf bytes');
    const mockFetch = makeAuthFetch(200, '', pdf);
    const client = makeClient(mockFetch);
    const result = await client.exportSubmissionPdf(FORM_UUID, SUB_UUID);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.equals(pdf)).toBe(true);
  });

  it('throws on non-200 status', async () => {
    const mockFetch = makeAuthFetch(500, 'boom');
    const client = makeClient(mockFetch);
    await expect(client.exportSubmissionPdf(FORM_UUID, SUB_UUID)).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});

describe('FormsApiClient authenticated error mapping', () => {
  it('maps 401 to AuthError with set-forms-key suggestion', async () => {
    const mockFetch = makeAuthFetch(401, 'unauthorized');
    const client = makeClient(mockFetch);
    await expect(client.listForms({ customerId: 42 })).rejects.toThrow(AuthError);
    await expect(client.listForms({ customerId: 42 })).rejects.toMatchObject({
      message: 'Forms API key is invalid or lacks the "forms" scope.',
      suggestion: expect.stringContaining('paubox auth set-forms-key'),
    });
  });

  it('maps 403 to ApiError with customer-id suggestion and body text', async () => {
    const mockFetch = makeAuthFetch(403, 'customer mismatch');
    const client = makeClient(mockFetch);
    await expect(client.listForms({})).rejects.toThrow(ApiError);
    await expect(client.listForms({})).rejects.toMatchObject({
      statusCode: 403,
      message: 'Forbidden (403): customer mismatch',
      suggestion: expect.stringContaining('--customer-id'),
    });
  });

  it('maps 404 to ApiError with not-found message', async () => {
    const mockFetch = makeAuthFetch(404, 'not found');
    const client = makeClient(mockFetch);
    await expect(client.getFormAdmin(FORM_UUID)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Form or submission not found.',
      suggestion: 'Check the ID and try again.',
    });
  });

  it('maps other errors to a generic ApiError including status and body', async () => {
    const mockFetch = makeAuthFetch(500, 'internal error');
    const client = makeClient(mockFetch);
    await expect(client.getFormStats()).rejects.toMatchObject({
      statusCode: 500,
      message: 'Request failed (500): internal error',
    });
  });
});

describe('FormsApiClient without a Forms API key', () => {
  const cases: Array<[string, (client: FormsApiClient) => Promise<unknown>]> = [
    ['listForms', (c) => c.listForms({ customerId: 42 })],
    ['getFormStats', (c) => c.getFormStats()],
    ['getFormAdmin', (c) => c.getFormAdmin(FORM_UUID)],
    [
      'createForm',
      (c) => c.createForm({ title: 't', customer_id: 1, form_json: {}, version: 1 }),
    ],
    ['updateForm', (c) => c.updateForm(FORM_UUID, { title: 't' })],
    ['archiveForm', (c) => c.archiveForm(FORM_UUID)],
    ['unarchiveForm', (c) => c.unarchiveForm(FORM_UUID)],
    ['copyForm', (c) => c.copyForm(FORM_UUID, 't')],
    ['listSubmissions', (c) => c.listSubmissions(FORM_UUID, {})],
    ['exportSubmissionsCsv', (c) => c.exportSubmissionsCsv(FORM_UUID)],
    ['exportSubmissionPdf', (c) => c.exportSubmissionPdf(FORM_UUID, SUB_UUID)],
  ];

  it.each(cases)('%s throws AuthError and never calls fetch', async (_name, call) => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch, null);
    await expect(call(client)).rejects.toThrow(AuthError);
    await expect(call(client)).rejects.toMatchObject({
      message: 'No Forms API key configured.',
      suggestion: expect.stringContaining('paubox auth set-forms-key'),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('public getForm still works without a key', async () => {
    const mockFetch = makeAuthFetch(200, FORM_RESPONSE);
    const client = makeClient(mockFetch, null);
    await expect(client.getForm(FORM_ID)).resolves.toEqual(FORM_RESPONSE);
  });
});

describe('FormsApiClient URL-path sanitization (paubox-python3 pattern)', () => {
  // Retargeted (`..`) calls return valid 200s so status-based assertions miss the bug.
  // These tests assert on the SDK behaviour before any fetch fires.

  const authMethods: Array<[string, (c: FormsApiClient, id: string) => Promise<unknown>]> = [
    ['getFormAdmin', (c, id) => c.getFormAdmin(id)],
    ['updateForm', (c, id) => c.updateForm(id, { title: 't' })],
    ['archiveForm', (c, id) => c.archiveForm(id)],
    ['unarchiveForm', (c, id) => c.unarchiveForm(id)],
    ['listSubmissions', (c, id) => c.listSubmissions(id, {})],
    ['exportSubmissionsCsv', (c, id) => c.exportSubmissionsCsv(id)],
    ['exportSubmissionPdf', (c, id) => c.exportSubmissionPdf(id, SUB_UUID)],
  ];

  it.each(authMethods)('%s rejects "..": no fetch fires', async (_name, call) => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch);
    await expect(call(client, '..')).rejects.toThrow(/path-traversal/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(authMethods)('%s rejects "." : no fetch fires', async (_name, call) => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch);
    await expect(call(client, '.')).rejects.toThrow(/path-traversal/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(authMethods)('%s rejects empty string: no fetch fires', async (_name, call) => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch);
    await expect(call(client, '')).rejects.toThrow(/formId is required/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(authMethods)('%s rejects non-UUID: no fetch fires', async (_name, call) => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch);
    await expect(call(client, 'not-a-uuid')).rejects.toThrow(/must be a UUID/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('exportSubmissionsCsv rejects "..": submissionId variant, no fetch fires', async () => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch);
    await expect(client.exportSubmissionsCsv(FORM_UUID, '..')).rejects.toThrow(/path-traversal/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('exportSubmissionPdf rejects "..": submissionId, no fetch fires', async () => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch);
    await expect(client.exportSubmissionPdf(FORM_UUID, '..')).rejects.toThrow(/path-traversal/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('exportSubmissionPdf rejects non-UUID submissionId: no fetch fires', async () => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch);
    await expect(client.exportSubmissionPdf(FORM_UUID, 'not-a-uuid')).rejects.toThrow(
      /must be a UUID/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  const publicMethods: Array<[string, (c: FormsApiClient, id: string) => Promise<unknown>]> = [
    ['getForm', (c, id) => c.getForm(id)],
    ['submitForm', (c, id) => c.submitForm(id, { form_data: {} })],
  ];

  it.each(publicMethods)('%s rejects "..": no fetch fires', async (_name, call) => {
    const mockFetch = makeAuthFetch(200, {});
    const client = makeClient(mockFetch);
    await expect(call(client, '..')).rejects.toThrow(/path-traversal/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(publicMethods)(
    '%s still accepts non-UUID form ids (backwards compat)',
    async (_name, call) => {
      const mockFetch = makeAuthFetch(200, {});
      const client = makeClient(mockFetch);
      await expect(call(client, 'legacy-non-uuid-id')).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );

});
