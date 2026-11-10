import { randomUUID } from 'crypto';
import { NetworkError, PauboxError } from './errors';
import { throwForResponse } from './api-errors';
import type { ErrorContext, ServiceName } from './api-errors';
import { readPackageVersion } from './version';

export type FetchFn = typeof fetch;

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Statuses worth retrying: the request was never processed, or was shed. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Transient transport failures. A refused or reset connection never ran. */
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN']);

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

/**
 * The command the user actually typed, e.g. "forms submit".
 *
 * Sent as `X-Paubox-Client-Command` so Paubox-side logs can attribute an error
 * to a command without the CLI phoning home. The command *name* only — never
 * arguments, addresses or message content, because these headers land in access
 * logs that are not a PHI boundary.
 */
let clientCommand = '';

export function setClientCommand(command: string): void {
  clientCommand = command;
}

export function getClientCommand(): string {
  return clientCommand;
}

let cachedUserAgent: string | null = null;

/** `paubox-cli/2.0.0 (node/v22.11.0; darwin arm64)` */
export function userAgent(): string {
  if (cachedUserAgent === null) {
    cachedUserAgent = `paubox-cli/${readPackageVersion()} (node/${process.version}; ${process.platform} ${process.arch})`;
  }
  return cachedUserAgent;
}

/**
 * The `pbcli-` prefix is load-bearing: it makes a request id self-identifying in
 * any log line that carries it, even where the proxy captures no client header.
 */
export function newRequestId(): string {
  return `pbcli-${randomUUID()}`;
}

/**
 * Headers that identify this client to every Paubox service.
 *
 * `X-Request-Id` round-trips: transactional_email adopts an inbound one via
 * ActionDispatch and echoes it back, so the id the user is shown on failure is
 * the same id in the server-side logs.
 */
export function clientHeaders(requestId: string): Record<string, string> {
  return {
    'User-Agent': userAgent(),
    'X-Paubox-Client': 'paubox-cli',
    'X-Paubox-Client-Version': readPackageVersion(),
    'X-Request-Id': requestId,
    ...(clientCommand ? { 'X-Paubox-Client-Command': clientCommand } : {}),
  };
}

/** Set from the global `--timeout` flag; takes precedence over the env var. */
let timeoutOverrideMs: number | null = null;

export function setTimeoutSeconds(seconds: number): void {
  timeoutOverrideMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

function resolveTimeout(): number {
  if (timeoutOverrideMs !== null) return timeoutOverrideMs;
  const raw = process.env.PAUBOX_TIMEOUT?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const seconds = Number(raw);
  // A malformed override falls back to the default rather than failing the
  // command: a bad env var should not be the reason a send does not go out.
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.round(seconds * 1000);
}

function debugEnabled(): boolean {
  const raw = process.env.PAUBOX_DEBUG?.trim();
  return raw !== undefined && raw !== '' && raw !== '0' && raw.toLowerCase() !== 'false';
}

function debug(message: string): void {
  if (debugEnabled()) process.stderr.write(`[paubox] ${message}\n`);
}

/** The libc/undici code, which undici buries one or two levels down in `cause`. */
function causeCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function causeMessage(err: unknown): string {
  let current: unknown = err;
  let message = err instanceof Error ? err.message : String(err);
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof Error && current.message) message = current.message;
    current = (current as { cause?: unknown }).cause;
  }
  return message;
}

/**
 * Translate a thrown fetch into something actionable.
 *
 * Node's fetch reports every transport failure as `TypeError: fetch failed` and
 * hides the reason in `cause`, so without this the user is told nothing at all.
 */
export function describeNetworkError(err: unknown, url: string, timeoutMs: number): NetworkError {
  const host = safeHost(url);

  if (err instanceof Error && err.name === 'TimeoutError') {
    return new NetworkError(
      `Request to ${host} timed out after ${Math.round(timeoutMs / 1000)}s.`,
      'Retry, or raise the limit with --timeout <seconds> or PAUBOX_TIMEOUT. ' +
        'Large attachments on a slow link are the usual cause.',
      'ETIMEDOUT',
    );
  }

  if (err instanceof Error && err.name === 'AbortError') {
    return new NetworkError(`Request to ${host} was aborted.`, undefined, 'ABORTED');
  }

  const code = causeCode(err);
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new NetworkError(
        `Could not resolve ${host}.`,
        'Check your DNS and network connection. If you are behind a corporate proxy, ' +
          'confirm it allows this host.',
        code,
      );
    case 'ECONNREFUSED':
      return new NetworkError(
        `Connection to ${host} was refused.`,
        'Nothing is listening at that address. If PAUBOX_FORMS_URL or PAUBOX_WEBHOOKS_URL ' +
          'is set, check it points somewhere real.',
        code,
      );
    case 'ECONNRESET':
      return new NetworkError(
        `Connection to ${host} was reset.`,
        'Usually transient — retry. A TLS-inspecting proxy can also cause this.',
        code,
      );
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return new NetworkError(
        `TLS certificate for ${host} could not be verified (${code}).`,
        'A TLS-intercepting proxy is the usual cause. Install your organisation’s root CA, ' +
          'or set NODE_EXTRA_CA_CERTS to point at it.',
        code,
      );
    default:
      return new NetworkError(
        `Could not reach ${host}: ${causeMessage(err)}${code ? ` (${code})` : ''}`,
        'Check your network connection and retry.',
        code,
      );
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RequestContext {
  /** Human phrase naming the attempt, e.g. "Send email". Starts any error message. */
  operation: string;
  /** Per-status suggestion overrides for cases the caller knows better. */
  hints?: Partial<Record<number, string>>;
  /** Skip the Authorization header — for the public, unauthenticated routes. */
  anonymous?: boolean;
  /** Safe to replay. Defaults to true for GET and false for everything else. */
  idempotent?: boolean;
}

export interface HttpClientConfig {
  service: ServiceName;
  /**
   * Resolved per request rather than per client so a missing credential raises
   * at the moment of use, with the operation known.
   */
  authHeaders: () => Record<string, string>;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

/**
 * The single path every outbound request takes.
 *
 * Centralising it is what makes client identification, timeouts, retries and
 * error mapping consistent across the three APIs instead of being re-derived at
 * each of the ~25 call sites.
 */
export class HttpClient {
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  constructor(private readonly config: HttpClientConfig) {
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? resolveTimeout();
  }

  /**
   * Perform a request, returning only on success. Any non-2xx response and any
   * transport failure is thrown as the appropriate PauboxError, already
   * carrying the request id.
   */
  async request(url: string, init: RequestInit = {}, ctx: RequestContext): Promise<Response> {
    const requestId = newRequestId();
    const method = (init.method ?? 'GET').toUpperCase();
    const idempotent = ctx.idempotent ?? method === 'GET';

    const headers: Record<string, string> = {
      ...clientHeaders(requestId),
      ...(ctx.anonymous ? {} : this.config.authHeaders()),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };

    let lastError: PauboxError | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (attempt > 0) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        debug(`retry ${attempt}/${MAX_RETRIES} in ${delay}ms`);
        await sleep(delay);
      }

      const started = Date.now();
      let response: Response;

      try {
        debug(`${method} ${url} (request_id=${requestId})`);
        response = await this.fetchFn(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const netError = describeNetworkError(err, url, this.timeoutMs);
        netError.requestId = requestId;
        debug(`transport failure: ${netError.code ?? 'unknown'} after ${Date.now() - started}ms`);
        if (idempotent && netError.code !== undefined && RETRYABLE_CODES.has(netError.code)) {
          lastError = netError;
          continue;
        }
        throw netError;
      }

      debug(`-> ${response.status} in ${Date.now() - started}ms`);

      if (response.ok) return response;

      if (idempotent && RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        // Drain the body so the connection can be reused on the retry.
        await response.text().catch(() => undefined);
        continue;
      }

      const errorCtx: ErrorContext = {
        service: this.config.service,
        operation: ctx.operation,
        hints: ctx.hints,
        requestId,
      };
      return throwForResponse(response, errorCtx);
    }

    // Only reachable when every attempt failed in transport on an idempotent
    // request; `lastError` is the final one.
    throw lastError ?? new NetworkError('Request failed after retries.');
  }
}
