import { extractMessage, throwForResponse } from '../../src/lib/api-errors';
import { ApiError, AuthError, ExitCode } from '../../src/lib/errors';
import { fakeResponse } from '../helpers/fake-response';

describe('extractMessage', () => {
  it('reads the Email API ErrorBuilder envelope', () => {
    const body = JSON.stringify({
      errors: [{ code: 422, title: 'Invalid Recipient', details: 'nope@ is not a valid address' }],
      sourceTrackingId: 'abc-123',
    });
    expect(extractMessage(body)).toBe('Invalid Recipient: nope@ is not a valid address');
  });

  it('reads the Email API request-schema envelope', () => {
    const body = JSON.stringify({ code: 400, title: 'Invalid Request', details: 'missing subject' });
    expect(extractMessage(body)).toBe('Invalid Request: missing subject');
  });

  it("reads render_error_page's {errors:[{message}]} shape", () => {
    expect(extractMessage(JSON.stringify({ errors: [{ message: '403 Forbidden' }] }))).toBe(
      '403 Forbidden',
    );
  });

  it('reads the pb_webhooks {message} envelope', () => {
    expect(extractMessage(JSON.stringify({ message: 'target_url must be https' }))).toBe(
      'target_url must be https',
    );
  });

  it('reads DRF field errors', () => {
    const body = JSON.stringify({ errors: { email: ['is invalid', 'is required'] } });
    expect(extractMessage(body)).toBe('email: is invalid, is required');
  });

  it('joins multiple errors', () => {
    const body = JSON.stringify({
      errors: [{ details: 'first problem' }, { details: 'second problem' }],
    });
    expect(extractMessage(body)).toBe('first problem; second problem');
  });

  it('falls back to the raw body when the shape is unknown', () => {
    expect(extractMessage('something went wrong')).toBe('something went wrong');
  });

  it('returns null for an empty body', () => {
    expect(extractMessage('')).toBeNull();
  });

  // haproxy serves a stock HTML page when no backend is healthy; surfacing it
  // verbatim is how the CLI used to print a web page at the user.
  it('returns null for an HTML gateway page', () => {
    expect(extractMessage('<html><body><h1>503 Service Unavailable</h1></body></html>')).toBeNull();
  });

  it('truncates a very long body', () => {
    const message = extractMessage('x'.repeat(1000));
    expect(message).toHaveLength(401);
    expect(message?.endsWith('…')).toBe(true);
  });
});

describe('throwForResponse', () => {
  const ctx = { service: 'email' as const, operation: 'Send email', requestId: 'pbcli-test' };

  it('maps 401 to an auth error naming the right key type', async () => {
    await expect(throwForResponse(fakeResponse(401), ctx)).rejects.toMatchObject({
      kind: 'auth',
      exitCode: ExitCode.AUTH,
    });
    await expect(throwForResponse(fakeResponse(401), ctx)).rejects.toThrow(AuthError);
    await expect(
      throwForResponse(fakeResponse(401), { ...ctx, service: 'forms' }),
    ).rejects.toThrow(/Forms API key/);
  });

  // Webhooks accepts either stored key, so a 401 must not blame only the Forms key.
  it('maps a webhooks 401 to a message covering both key types', async () => {
    const err = await throwForResponse(fakeResponse(401), { ...ctx, service: 'webhooks' }).catch(
      (e: unknown) => e as AuthError,
    );
    expect(err.message).toBe('The API key used for webhooks was rejected.');
    expect(err.suggestion).toContain('Forms key if one is stored, otherwise your Email API key');
  });

  it('maps 403 to an auth error, not an api error', async () => {
    await expect(
      throwForResponse(fakeResponse(403, { message: 'not scoped' }), { ...ctx, service: 'webhooks' }),
    ).rejects.toMatchObject({ kind: 'auth', statusCode: 403 });
  });

  it('puts the parsed detail in the message for a 422', async () => {
    const body = { errors: [{ title: 'Invalid Recipient', details: 'nope@ is not valid' }] };
    await expect(throwForResponse(fakeResponse(422, body), ctx)).rejects.toThrow(
      'Send email failed (422 Unprocessable Entity): Invalid Recipient: nope@ is not valid',
    );
  });

  it('prefers a caller hint over the default suggestion', async () => {
    await expect(
      throwForResponse(fakeResponse(404), { ...ctx, hints: { 404: 'Run `paubox forms list`.' } }),
    ).rejects.toMatchObject({ suggestion: 'Run `paubox forms list`.' });
  });

  it('surfaces Retry-After on a 429', async () => {
    await expect(
      throwForResponse(fakeResponse(429, '', { 'Retry-After': '30' }), ctx),
    ).rejects.toMatchObject({ suggestion: expect.stringContaining('30s') });
  });

  it('names the gateway for a 503 with an HTML body', async () => {
    const page = '<html><body>503 Service Unavailable</body></html>';
    await expect(throwForResponse(fakeResponse(503, page), ctx)).rejects.toThrow(
      /no healthy backend/,
    );
  });

  it('keeps the service detail for a 500 that explains itself', async () => {
    await expect(
      throwForResponse(fakeResponse(500, { message: 'template render failed' }), ctx),
    ).rejects.toThrow(/template render failed/);
  });

  it('attaches the request id to every error it raises', async () => {
    await expect(throwForResponse(fakeResponse(500), ctx)).rejects.toMatchObject({
      requestId: 'pbcli-test',
    });
  });

  it('uses the api exit code for server-side failures', async () => {
    await expect(throwForResponse(fakeResponse(500), ctx)).rejects.toMatchObject({
      exitCode: ExitCode.API,
    });
    await expect(throwForResponse(fakeResponse(500), ctx)).rejects.toThrow(ApiError);
  });
});
