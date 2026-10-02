import { PauboxApiClient } from '../../src/lib/api';
import { ApiError, AuthError } from '../../src/lib/errors';

function makeFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
    arrayBuffer: jest.fn().mockResolvedValue(
      new Uint8Array([0x50, 0x4b]).buffer,
    ),
  });
}

const EMAIL_ID = '0192f0c4-0000-7000-8000-000000000001';
const ATTACHMENT_ID = '0192f0c4-0000-7000-8000-0000000000a1';

const creds = { apiKey: 'testapikey' };

describe('PauboxApiClient receiving', () => {
  describe('listReceivingDomains', () => {
    it('calls GET /receiving/domains', async () => {
      const domains = [{ id: 1, slug: 'example.com' }];
      const mockFetch = makeFetch(200, domains);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.listReceivingDomains();

      expect(result).toEqual(domains);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.paubox.com/v1/email/receiving/domains',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Token token=testapikey',
          }),
        }),
      );
    });

    it('throws AuthError on 401', async () => {
      const mockFetch = makeFetch(401, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      await expect(client.listReceivingDomains()).rejects.toThrow(AuthError);
    });

    it('throws ApiError on non-401 error', async () => {
      const mockFetch = makeFetch(500, 'Internal error');
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      await expect(client.listReceivingDomains()).rejects.toThrow(ApiError);
    });
  });

  describe('createReceivingDomain', () => {
    it('calls POST /receiving/domains with slug', async () => {
      const domain = { id: 2, slug: 'test.com' };
      const mockFetch = makeFetch(200, domain);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.createReceivingDomain('test.com');

      expect(result).toEqual(domain);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.paubox.com/v1/email/receiving/domains');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ slug: 'test.com' });
    });

    it('calls POST without body when slug is omitted', async () => {
      const domain = { id: 3, slug: 'auto.com' };
      const mockFetch = makeFetch(200, domain);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      await client.createReceivingDomain();

      const [, init] = mockFetch.mock.calls[0];
      expect(init.body).toBeUndefined();
    });
  });

  describe('getReceivingDomain', () => {
    it('calls GET /receiving/domains/:id', async () => {
      const domain = { id: 5, slug: 'get.com' };
      const mockFetch = makeFetch(200, domain);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.getReceivingDomain('5');

      expect(result).toEqual(domain);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.paubox.com/v1/email/receiving/domains/5',
      );
    });
  });

  describe('deleteReceivingDomain', () => {
    it('calls DELETE /receiving/domains/:id', async () => {
      const mockFetch = makeFetch(204, '');
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      await client.deleteReceivingDomain('5');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.paubox.com/v1/email/receiving/domains/5');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('listMailboxes', () => {
    it('calls GET /receiving/domains/:domainId/mailboxes', async () => {
      const mailboxes = [{ id: 1, name: 'info' }];
      const mockFetch = makeFetch(200, mailboxes);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.listMailboxes('3');

      expect(result).toEqual(mailboxes);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.paubox.com/v1/email/receiving/domains/3/mailboxes',
      );
    });
  });

  describe('createMailbox', () => {
    it('posts mailbox with name, password, and optional quota', async () => {
      const mailbox = { id: 10, name: 'support' };
      const mockFetch = makeFetch(200, mailbox);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.createMailbox('3', {
        name: 'support',
        password: 'secret',
        quota_bytes: 1073741824,
      });

      expect(result).toEqual(mailbox);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://api.paubox.com/v1/email/receiving/domains/3/mailboxes',
      );
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        name: 'support',
        password: 'secret',
        quota_bytes: 1073741824,
      });
    });
  });

  describe('getMailbox', () => {
    it('calls GET /receiving/domains/:domainId/mailboxes/:id', async () => {
      const mailbox = { id: 10, name: 'support' };
      const mockFetch = makeFetch(200, mailbox);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.getMailbox('3', '10');

      expect(result).toEqual(mailbox);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.paubox.com/v1/email/receiving/domains/3/mailboxes/10',
      );
    });
  });

  describe('deleteMailbox', () => {
    it('calls DELETE /receiving/domains/:domainId/mailboxes/:id', async () => {
      const mockFetch = makeFetch(204, '');
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      await client.deleteMailbox('3', '10');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://api.paubox.com/v1/email/receiving/domains/3/mailboxes/10',
      );
      expect(init.method).toBe('DELETE');
    });
  });

  describe('listReceivedEmails', () => {
    it('calls GET /receiving with no params and returns the list envelope', async () => {
      const list = {
        object: 'list',
        data: [{ email_id: EMAIL_ID, from: [], to: [], subject: null }],
        has_more: false,
      };
      const mockFetch = makeFetch(200, list);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.listReceivedEmails();

      expect(result).toEqual(list);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.paubox.com/v1/email/receiving',
      );
    });

    it('appends query params when provided', async () => {
      const mockFetch = makeFetch(200, { object: 'list', data: [], has_more: false });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      await client.listReceivedEmails({ limit: 10, after: EMAIL_ID, before: 'b' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=10');
      expect(url).toContain(`after=${EMAIL_ID}`);
      expect(url).toContain('before=b');
    });
  });

  describe('getReceivedEmail', () => {
    it('calls GET /receiving/:emailId and returns the data envelope', async () => {
      const body = { data: { email_id: EMAIL_ID, subject: 'Test', attachments: [] } };
      const mockFetch = makeFetch(200, body);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.getReceivedEmail(EMAIL_ID);

      expect(result).toEqual(body);
      expect(mockFetch.mock.calls[0][0]).toBe(
        `https://api.paubox.com/v1/email/receiving/${EMAIL_ID}`,
      );
    });

    it('explains Paubox email ids on 404', async () => {
      const mockFetch = makeFetch(404, { error: 'not found' });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const err = await client.getReceivedEmail('eaaaaab').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(404);
      expect((err as ApiError).suggestion).toContain('email_id');
    });

    it('does not attach the id hint to other errors', async () => {
      const mockFetch = makeFetch(500, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const err = await client.getReceivedEmail(EMAIL_ID).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).suggestion).toBeUndefined();
    });
  });

  describe('downloadAttachment', () => {
    it('calls GET /receiving/:emailId/attachments/:attachmentId and returns raw bytes', async () => {
      const mockFetch = makeFetch(200, {}, {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="report.pdf"',
      });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.downloadAttachment(EMAIL_ID, ATTACHMENT_ID);

      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect([...result.data]).toEqual([0x50, 0x4b]);
      expect(result.filename).toBe('report.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(mockFetch.mock.calls[0][0]).toBe(
        `https://api.paubox.com/v1/email/receiving/${EMAIL_ID}/attachments/${ATTACHMENT_ID}`,
      );
      const response = await mockFetch.mock.results[0].value;
      expect(response.json).not.toHaveBeenCalled();
    });

    it('returns a null filename when Content-Disposition has none', async () => {
      const mockFetch = makeFetch(200, {}, { 'content-disposition': 'attachment' });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.downloadAttachment(EMAIL_ID, ATTACHMENT_ID);

      expect(result.filename).toBeNull();
    });

    it('returns null filename and content type when the headers are absent', async () => {
      const mockFetch = makeFetch(200, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.downloadAttachment(EMAIL_ID, ATTACHMENT_ID);

      expect(result.filename).toBeNull();
      expect(result.contentType).toBeNull();
    });

    it('reads an unquoted filename', async () => {
      const mockFetch = makeFetch(200, {}, {
        'content-disposition': 'attachment; filename=notes.txt; size=4',
      });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.downloadAttachment(EMAIL_ID, ATTACHMENT_ID);

      expect(result.filename).toBe('notes.txt');
    });

    it('throws AuthError on 401', async () => {
      const mockFetch = makeFetch(401, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      await expect(client.downloadAttachment(EMAIL_ID, ATTACHMENT_ID)).rejects.toThrow(AuthError);
    });

    it('explains Paubox attachment ids on 404', async () => {
      const mockFetch = makeFetch(404, { error: 'attachment not found' });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const err = await client.downloadAttachment(EMAIL_ID, 'blob-1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).suggestion).toContain('attachment id');
    });
  });
});
