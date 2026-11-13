/**
 * Minimal stand-in for a fetch Response.
 *
 * Deliberately not a real Response: the clients only read `ok`, `status`,
 * `headers.get`, `text`, `json` and `arrayBuffer`, and building real ones makes
 * the error-mapping tests harder to read than the behaviour they assert.
 */
export function fakeResponse(
  status: number,
  body: string | object = '',
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name: string) => lowerHeaders[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text === '' ? 'null' : text)),
    arrayBuffer: () => Promise.resolve(Buffer.from(text).buffer),
  } as unknown as Response;
}

/** A thrown fetch failure shaped the way undici nests the real cause. */
export function transportFailure(code: string, message = 'fetch failed'): Error {
  const err = new TypeError(message);
  (err as { cause?: unknown }).cause = Object.assign(new Error(message), { code });
  return err;
}
