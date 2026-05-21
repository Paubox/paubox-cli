import { FormsApiClient } from '../../src/lib/forms-api';
import { ApiError } from '../../src/lib/errors';

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
