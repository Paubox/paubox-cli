import { ApiError, AuthError, PauboxError } from './errors';

export type ServiceName = 'email' | 'forms' | 'webhooks';

export interface ErrorContext {
  service: ServiceName;
  /** Human phrase naming the attempt, e.g. "Send email". Starts the message. */
  operation: string;
  /** Per-status suggestion overrides, for cases a caller knows better than we do. */
  hints?: Partial<Record<number, string>>;
  /** The `X-Request-Id` sent with the failing request. */
  requestId?: string;
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

const MAX_DETAIL_LENGTH = 400;

/**
 * Which stored credential a service authenticates with. The two are not
 * interchangeable, and sending the wrong one is indistinguishable from sending
 * a bad one unless the message says so.
 */
function collapse(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_DETAIL_LENGTH ? `${flat.slice(0, MAX_DETAIL_LENGTH)}…` : flat;
}

function isHtml(body: string): boolean {
  return /^\s*(?:<!doctype|<html|<head|<body)/i.test(body);
}

/** One entry from the Email API's ErrorBuilder envelope. */
function fromErrorObject(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (typeof entry !== 'object' || entry === null) return null;

  const obj = entry as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title : null;
  const details = typeof obj.details === 'string' ? obj.details : null;
  const message = typeof obj.message === 'string' ? obj.message : null;

  if (title && details && title !== details) return `${title}: ${details}`;
  return details ?? title ?? message;
}

/**
 * Pull a human sentence out of whatever the service returned.
 *
 * Deliberately shape-agnostic rather than one parser per service: the three
 * backends already use four different envelopes between them, and a service
 * changing its shape should degrade to the raw body rather than to "undefined".
 * Returns null when there is nothing worth showing (empty body, or an HTML
 * error page from the gateway, which is noise rather than information).
 */
export function extractMessage(body: string): string | null {
  if (body.trim() === '') return null;
  if (isHtml(body)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return collapse(body);
  }

  if (typeof parsed === 'string') return collapse(parsed);
  if (typeof parsed !== 'object' || parsed === null) return collapse(body);

  const obj = parsed as Record<string, unknown>;

  // pb_webhooks: {"message": "..."} — and DRF: {"detail": "..."}
  if (typeof obj.message === 'string' && obj.message !== '') return collapse(obj.message);
  if (typeof obj.detail === 'string' && obj.detail !== '') return collapse(obj.detail);
  if (typeof obj.error === 'string' && obj.error !== '') return collapse(obj.error);

  // Email API ErrorBuilder: {"errors": [{code, title, details}], "sourceTrackingId": "..."}
  if (Array.isArray(obj.errors)) {
    const parts = obj.errors.map(fromErrorObject).filter((p): p is string => Boolean(p));
    if (parts.length > 0) return collapse(parts.join('; '));
  }

  // DRF field errors: {"errors": {"email": ["is invalid"]}} — also seen at the top level.
  const fieldSource =
    obj.errors !== undefined && typeof obj.errors === 'object' && obj.errors !== null
      ? (obj.errors as Record<string, unknown>)
      : obj;
  const fieldParts: string[] = [];
  for (const [field, value] of Object.entries(fieldSource)) {
    if (field === 'sourceTrackingId' || field === 'code') continue;
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      fieldParts.push(`${field}: ${(value as string[]).join(', ')}`);
    }
  }
  if (fieldParts.length > 0) return collapse(fieldParts.join('; '));

  // Email API request-schema validator: {"code": 400, "title": "...", "details": "..."}
  const single = fromErrorObject(obj);
  if (single) return collapse(single);

  return collapse(body);
}

/**
 * Read the body without letting a broken stream mask the real failure — the
 * status code is the thing we must not lose.
 */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function genericStatusText(status: number): string {
  if (status >= 500) return 'Server Error';
  if (status >= 400) return 'Client Error';
  return 'Error';
}

function headline(operation: string, status: number, detail: string | null): string {
  const statusText = STATUS_TEXT[status] ?? genericStatusText(status);
  return detail
    ? `${operation} failed (${status} ${statusText}): ${detail}`
    : `${operation} failed (${status} ${statusText}).`;
}

function retryAfterHint(response: Response): string {
  const retryAfter = response.headers?.get?.('retry-after');
  return retryAfter
    ? `The API is rate limiting this key. Retry after ${retryAfter}s.`
    : 'The API is rate limiting this key. Wait before retrying, and reduce concurrency.';
}

/**
 * Turn a non-OK response into the right typed error and throw it.
 *
 * Every client funnels its failures through here so that a given status means
 * the same thing, carries the same exit code, and names the same remedy
 * regardless of which of the three APIs produced it.
 */
export async function throwForResponse(response: Response, ctx: ErrorContext): Promise<never> {
  const status = response.status;
  const body = await safeText(response);
  const detail = extractMessage(body);
  const hint = ctx.hints?.[status];

  const fail = (err: PauboxError): never => {
    err.requestId = ctx.requestId;
    throw err;
  };

  if (status === 401) {
    return fail(AuthError.invalid(ctx.service));
  }

  if (status === 403) {
    return fail(
      AuthError.forbidden(
        headline(ctx.operation, status, detail),
        hint ??
          (ctx.service === 'webhooks'
            ? 'The key authenticated but is not scoped for one of the requested events. ' +
              'Check its scopes in the Paubox dashboard under API keys.'
            : undefined),
      ),
    );
  }

  if (status === 404) {
    return fail(
      new ApiError(
        headline(ctx.operation, status, detail),
        404,
        hint ?? 'Check the id in the command — the API did not recognise it.',
      ),
    );
  }

  if (status === 413) {
    return fail(
      new ApiError(
        headline(ctx.operation, status, detail),
        413,
        hint ?? 'Reduce the number or size of --attachment files. The API caps a request at 250 MB.',
      ),
    );
  }

  if (status === 429) {
    return fail(new ApiError(headline(ctx.operation, status, detail), 429, hint ?? retryAfterHint(response)));
  }

  if (status === 400 || status === 422) {
    return fail(
      new ApiError(
        headline(ctx.operation, status, detail),
        status,
        hint ?? 'The API rejected the request as malformed. Fix the field named above and retry.',
      ),
    );
  }

  if (status >= 500) {
    // A 502/503/504 with an HTML body is the gateway, not the service: haproxy
    // serves its own error pages when no backend is healthy, so the body is a
    // stock page rather than anything about this request.
    const gateway = status !== 500 && (detail === null || isHtml(body));
    return fail(
      new ApiError(
        gateway
          ? `${ctx.operation} failed (${status} ${STATUS_TEXT[status] ?? 'Server Error'}): the Paubox API gateway has no healthy backend for this request.`
          : headline(ctx.operation, status, detail),
        status,
        hint ??
          (gateway
            ? 'This is a Paubox-side outage, not a problem with your request. Retry shortly; if it persists, contact support with the request ID above.'
            : 'This is a Paubox-side error. Retry shortly; if it persists, contact support with the request ID above.'),
      ),
    );
  }

  return fail(new ApiError(headline(ctx.operation, status, detail), status, hint));
}
