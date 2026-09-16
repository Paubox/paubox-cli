import { PauboxApiClient } from '../../src/lib/api';
import { ApiError, AuthError } from '../../src/lib/errors';

function makeFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
    arrayBuffer: jest.fn().mockResolvedValue(
      new Uint8Array([0x50, 0x4b]).buffer,
    ),
  });
}

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
    it('calls GET /receiving with no params', async () => {
      const emails = [{ id: 1 }];
      const mockFetch = makeFetch(200, emails);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.listReceivedEmails();

      expect(result).toEqual(emails);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.paubox.com/v1/email/receiving',
      );
    });

    it('appends query params when provided', async () => {
      const mockFetch = makeFetch(200, []);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      await client.listReceivedEmails({ limit: 10, after: 'cursor-abc' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=10');
      expect(url).toContain('after=cursor-abc');
    });
  });

  describe('getReceivedEmail', () => {
    it('calls GET /receiving/:emailId', async () => {
      const email = { id: 42, subject: 'Test' };
      const mockFetch = makeFetch(200, email);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.getReceivedEmail('42');

      expect(result).toEqual(email);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.paubox.com/v1/email/receiving/42',
      );
    });
  });

  describe('downloadAttachment', () => {
    it('calls GET /receiving/:emailId/attachments/:blobId and returns Buffer', async () => {
      const mockFetch = makeFetch(200, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.downloadAttachment('42', 'blob-1');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.paubox.com/v1/email/receiving/42/attachments/blob-1',
      );
    });

    it('throws AuthError on 401', async () => {
      const mockFetch = makeFetch(401, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      await expect(client.downloadAttachment('42', 'blob-1')).rejects.toThrow(AuthError);
    });
  });
});
