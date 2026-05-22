import { printDebug } from './output';

export interface DebugOptions {
  verbose?: boolean;
}

function redactAuth(headers: Record<string, string>): Record<string, string> {
  const redacted = { ...headers };
  if (redacted['Authorization'] || redacted['authorization']) {
    const key = redacted['Authorization'] ? 'Authorization' : 'authorization';
    redacted[key] = 'Token token=****';
  }
  return redacted;
}

function truncateBody(body: string, maxLength = 500): string {
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength) + `... (${body.length - maxLength} more chars)`;
}

export function createVerboseFetch(baseFetch: typeof fetch, debug: DebugOptions): typeof fetch {
  if (!debug.verbose) return baseFetch;

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';

    printDebug('Request', `${method} ${url}`);

    if (init?.headers) {
      const headers = init.headers as Record<string, string>;
      printDebug('Request Headers', redactAuth(headers));
    }

    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body);
        const redactedBody = redactPayloadContent(parsed);
        printDebug('Request Body', redactedBody);
      } catch {
        printDebug('Request Body', truncateBody(init.body));
      }
    }

    const startTime = Date.now();
    const response = await baseFetch(input, init);
    const duration = Date.now() - startTime;

    printDebug('Response', `${response.status} ${response.statusText} (${duration}ms)`);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    printDebug('Response Headers', responseHeaders);

    const clonedResponse = response.clone();
    try {
      const text = await clonedResponse.text();
      if (text) {
        try {
          const json = JSON.parse(text);
          printDebug('Response Body', json);
        } catch {
          printDebug('Response Body', truncateBody(text));
        }
      }
    } catch {
      printDebug('Response Body', '(unable to read)');
    }

    return response;
  };
}

function redactPayloadContent(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactPayloadContent);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === 'content' && typeof value === 'string' && value.length > 100) {
      result[key] = `[base64 data, ${value.length} chars]`;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactPayloadContent(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
