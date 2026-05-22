import { createVerboseFetch } from '../../src/lib/debug';

function createMockHeaders(entries: [string, string][]): Headers {
  const headers = {
    forEach: (cb: (value: string, key: string) => void) => {
      entries.forEach(([k, v]) => cb(v, k));
    },
  };
  return headers as unknown as Headers;
}

function createMockResponse(
  status: number,
  statusText: string,
  headers: [string, string][],
  body: string,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: createMockHeaders(headers),
    clone: () => ({
      text: async () => body,
    }),
  };
}

describe('createVerboseFetch', () => {
  const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

  beforeEach(() => {
    stderrSpy.mockClear();
  });

  afterAll(() => {
    stderrSpy.mockRestore();
  });

  it('returns base fetch unchanged when verbose is false', () => {
    const baseFetch = jest.fn();
    const result = createVerboseFetch(baseFetch as unknown as typeof fetch, { verbose: false });
    expect(result).toBe(baseFetch);
  });

  it('returns base fetch unchanged when debug is undefined', () => {
    const baseFetch = jest.fn();
    const result = createVerboseFetch(baseFetch as unknown as typeof fetch, {});
    expect(result).toBe(baseFetch);
  });

  it('wraps fetch with logging when verbose is true', async () => {
    const mockResponse = createMockResponse(200, 'OK', [['content-type', 'application/json']], '{"result":"ok"}');

    const baseFetch = jest.fn().mockResolvedValue(mockResponse);
    const verboseFetch = createVerboseFetch(baseFetch as unknown as typeof fetch, { verbose: true });

    await verboseFetch('https://api.example.com/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Token token=secret123' },
      body: JSON.stringify({ data: 'test' }),
    });

    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalled();

    const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[DEBUG]');
    expect(output).toContain('POST https://api.example.com/test');
    expect(output).toContain('Token token=****');
    expect(output).not.toContain('secret123');
    expect(output).toContain('200 OK');
  });

  it('redacts large base64 content in request body', async () => {
    const mockResponse = createMockResponse(201, 'Created', [], '');

    const baseFetch = jest.fn().mockResolvedValue(mockResponse);
    const verboseFetch = createVerboseFetch(baseFetch as unknown as typeof fetch, { verbose: true });

    const largeContent = 'a'.repeat(200);
    await verboseFetch('https://api.example.com/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [{ fileName: 'test.pdf', content: largeContent }],
      }),
    });

    const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[base64 data, 200 chars]');
    expect(output).not.toContain(largeContent);
  });

  it('truncates long non-JSON bodies', async () => {
    const mockResponse = createMockResponse(200, 'OK', [], 'x'.repeat(600));

    const baseFetch = jest.fn().mockResolvedValue(mockResponse);
    const verboseFetch = createVerboseFetch(baseFetch as unknown as typeof fetch, { verbose: true });

    await verboseFetch('https://api.example.com/test');

    const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('... (100 more chars)');
  });
});
