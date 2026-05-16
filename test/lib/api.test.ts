import { PauboxApiClient, resolveAttachments } from '../../src/lib/api';
import { ApiError, AuthError } from '../../src/lib/errors';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function makeFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  });
}

const creds = { apiUsername: 'testuser', apiKey: 'testapikey' };

describe('PauboxApiClient', () => {
  describe('sendEmail', () => {
    it('posts to the correct endpoint with auth header', async () => {
      const mockFetch = makeFetch(200, { sourceTrackingId: 'track-1', data: 'Service accepted' });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.sendEmail({
        to: ['to@example.com'],
        from: 'from@example.com',
        subject: 'Hello',
        text: 'World',
      });

      expect(result.sourceTrackingId).toBe('track-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.paubox.net/v1/testuser/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Token token=testapikey',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('builds payload with text and html content', async () => {
      const mockFetch = makeFetch(200, { sourceTrackingId: 'x', data: 'ok' });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      await client.sendEmail({
        to: ['a@b.com', 'c@d.com'],
        from: 'f@g.com',
        subject: 'Sub',
        text: 'plain',
        html: '<b>html</b>',
      });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.data.message.recipients).toEqual(['a@b.com', 'c@d.com']);
      expect(body.data.message.content['text/plain']).toBe('plain');
      expect(body.data.message.content['text/html']).toBe('<b>html</b>');
      expect(body.data.message.headers.subject).toBe('Sub');
    });

    it('throws AuthError on 401', async () => {
      const mockFetch = makeFetch(401, { error: 'Unauthorized' });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      await expect(
        client.sendEmail({ to: ['x@y.com'], from: 'a@b.com', subject: 's', text: 't' }),
      ).rejects.toThrow(AuthError);
    });

    it('throws ApiError on non-401 error', async () => {
      const mockFetch = makeFetch(422, 'Unprocessable');
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      await expect(
        client.sendEmail({ to: ['x@y.com'], from: 'a@b.com', subject: 's', text: 't' }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('getMessageStatus', () => {
    it('calls the correct endpoint', async () => {
      const responseBody = {
        sourceTrackingId: 'track-1',
        data: { message: { id: '1', message_deliveries: [] } },
      };
      const mockFetch = makeFetch(200, responseBody);
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);

      const result = await client.getMessageStatus('track-1');
      expect(result.sourceTrackingId).toBe('track-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.paubox.net/v1/testuser/message_receipt?sourceTrackingId=track-1',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Token token=testapikey' }),
        }),
      );
    });

    it('URL-encodes the tracking ID', async () => {
      const mockFetch = makeFetch(200, { sourceTrackingId: 'a b', data: { message: { id: '1', message_deliveries: [] } } });
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      await client.getMessageStatus('a b');
      expect(mockFetch.mock.calls[0][0]).toContain('sourceTrackingId=a%20b');
    });

    it('throws AuthError on 401', async () => {
      const mockFetch = makeFetch(401, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      await expect(client.getMessageStatus('x')).rejects.toThrow(AuthError);
    });
  });

  describe('validateCredentials', () => {
    it('returns true when status is not 401', async () => {
      const mockFetch = makeFetch(200, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      expect(await client.validateCredentials()).toBe(true);
    });

    it('returns false on 401', async () => {
      const mockFetch = makeFetch(401, {});
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      expect(await client.validateCredentials()).toBe(false);
    });

    it('returns false on network error', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const client = new PauboxApiClient(creds, mockFetch as unknown as typeof fetch);
      expect(await client.validateCredentials()).toBe(false);
    });
  });
});

describe('resolveAttachments', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-attach-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads a file and returns base64 content', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');
    const [att] = resolveAttachments([filePath]);
    expect(att.fileName).toBe('test.txt');
    expect(att.contentType).toBe('text/plain');
    expect(att.content).toBe(Buffer.from('hello').toString('base64'));
  });

  it('detects MIME type from extension', () => {
    const filePath = path.join(tmpDir, 'doc.pdf');
    fs.writeFileSync(filePath, '%PDF');
    const [att] = resolveAttachments([filePath]);
    expect(att.contentType).toBe('application/pdf');
  });

  it('throws ApiError for missing file', () => {
    expect(() => resolveAttachments(['/nonexistent/file.txt'])).toThrow(ApiError);
  });
});
