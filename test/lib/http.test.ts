import {
  HttpClient,
  clientHeaders,
  describeNetworkError,
  newRequestId,
  setClientCommand,
  setTimeoutSeconds,
  userAgent,
} from '../../src/lib/http';
import { ApiError, AuthError, ExitCode, NetworkError } from '../../src/lib/errors';
import { fakeResponse, transportFailure } from '../helpers/fake-response';

function client(fetchFn: jest.Mock): HttpClient {
  return new HttpClient({
    service: 'email',
    fetchFn: fetchFn as unknown as typeof fetch,
    authHeaders: () => ({ Authorization: 'Token token=k' }),
  });
}

afterEach(() => {
  setClientCommand('');
  setTimeoutSeconds(NaN);
  delete process.env.PAUBOX_TIMEOUT;
});

describe('client identification', () => {
  it('builds a User-Agent naming the CLI, its version and the runtime', () => {
    expect(userAgent()).toMatch(/^paubox-cli\/\d+\.\d+\.\d+ \(node\/v\d+/);
  });

  it('prefixes request ids so they are self-identifying in a log line', () => {
    expect(newRequestId()).toMatch(/^pbcli-[0-9a-f-]{36}$/);
  });

  it('sends the identification headers on every request', () => {
    const headers = clientHeaders('pbcli-abc');
    expect(headers['X-Paubox-Client']).toBe('paubox-cli');
    expect(headers['X-Request-Id']).toBe('pbcli-abc');
    expect(headers['X-Paubox-Client-Version']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('includes the command name once a command is running', () => {
    expect(clientHeaders('x')['X-Paubox-Client-Command']).toBeUndefined();
    setClientCommand('forms submit');
    expect(clientHeaders('x')['X-Paubox-Client-Command']).toBe('forms submit');
  });

  it('attaches the headers to the outbound request', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(200, {}));
    await client(fetchFn).request('https://api.paubox.com/v1/email/x', {}, { operation: 'Probe' });

    const headers = fetchFn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('paubox-cli/');
    expect(headers['X-Request-Id']).toMatch(/^pbcli-/);
    expect(headers.Authorization).toBe('Token token=k');
  });

  it('skips the auth header on anonymous routes', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(200, {}));
    await client(fetchFn).request('https://x.test/public', {}, {
      operation: 'Get form',
      anonymous: true,
    });
    expect((fetchFn.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('describeNetworkError', () => {
  const url = 'https://api.paubox.com/v1/email/messages';

  it('names a DNS failure instead of "fetch failed"', () => {
    const err = describeNetworkError(transportFailure('ENOTFOUND'), url, 30_000);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.message).toBe('Could not resolve api.paubox.com.');
    expect(err.exitCode).toBe(ExitCode.NETWORK);
  });

  it('names a refused connection and points at the URL overrides', () => {
    const err = describeNetworkError(transportFailure('ECONNREFUSED'), url, 30_000);
    expect(err.message).toContain('refused');
    expect(err.suggestion).toContain('PAUBOX_FORMS_URL');
  });

  it('explains a TLS interception failure', () => {
    const err = describeNetworkError(transportFailure('SELF_SIGNED_CERT_IN_CHAIN'), url, 30_000);
    expect(err.message).toContain('TLS certificate');
    expect(err.suggestion).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('reports a timeout with the limit that was hit', () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const err = describeNetworkError(timeout, url, 45_000);
    expect(err.message).toContain('timed out after 45s');
    expect(err.suggestion).toContain('--timeout');
  });

  it('still says something useful for an unrecognised cause', () => {
    const err = describeNetworkError(new TypeError('fetch failed'), url, 30_000);
    expect(err.message).toContain('Could not reach api.paubox.com');
  });
});

describe('HttpClient', () => {
  it('returns the response unchanged on success', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    const response = await client(fetchFn).request('https://x.test/a', {}, { operation: 'Probe' });
    expect(await response.json()).toEqual({ ok: true });
  });

  it('maps a failing status through the shared error mapper', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(401));
    await expect(
      client(fetchFn).request('https://x.test/a', {}, { operation: 'Probe' }),
    ).rejects.toThrow(AuthError);
  });

  it('stamps the request id it sent onto the error', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(500));
    const promise = client(fetchFn).request('https://x.test/a', {}, { operation: 'Probe' });
    await expect(promise).rejects.toMatchObject({ requestId: expect.stringMatching(/^pbcli-/) });

    const sent = (fetchFn.mock.calls[0][1].headers as Record<string, string>)['X-Request-Id'];
    await expect(promise).rejects.toMatchObject({ requestId: sent });
  });

  it('retries a GET on 503 and succeeds', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(fakeResponse(503, '<html>down</html>'))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));

    const response = await client(fetchFn).request('https://x.test/a', {}, { operation: 'Probe' });
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // A send that may have been accepted must never be replayed.
  it('does not retry a POST', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(503, '<html>down</html>'));
    await expect(
      client(fetchFn).request('https://x.test/a', { method: 'POST' }, { operation: 'Send email' }),
    ).rejects.toThrow(ApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a GET through a transient transport failure', async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValueOnce(transportFailure('ECONNRESET'))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));

    const response = await client(fetchFn).request('https://x.test/a', {}, { operation: 'Probe' });
    expect(await response.json()).toEqual({ ok: true });
  });

  it('does not retry a permanent transport failure', async () => {
    const fetchFn = jest.fn().mockRejectedValue(transportFailure('ENOTFOUND'));
    await expect(
      client(fetchFn).request('https://x.test/a', {}, { operation: 'Probe' }),
    ).rejects.toThrow(NetworkError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget and reports the transport failure', async () => {
    const fetchFn = jest.fn().mockRejectedValue(transportFailure('ECONNRESET'));
    await expect(
      client(fetchFn).request('https://x.test/a', {}, { operation: 'Probe' }),
    ).rejects.toThrow(/reset/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('passes an abort signal so a request cannot hang forever', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(200, {}));
    await client(fetchFn).request('https://x.test/a', {}, { operation: 'Probe' });
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('raises the auth error before making a request when no key is stored', async () => {
    const fetchFn = jest.fn();
    const noKey = new HttpClient({
      service: 'forms',
      fetchFn: fetchFn as unknown as typeof fetch,
      authHeaders: () => {
        throw AuthError.missing('forms');
      },
    });

    await expect(noKey.request('https://x.test/a', {}, { operation: 'List forms' })).rejects.toThrow(
      /No Forms API key is stored/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
