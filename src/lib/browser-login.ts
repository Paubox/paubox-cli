import { spawn } from 'child_process';
import { timingSafeEqual } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { AuthError } from './errors';
import {
  confirmationCode,
  createLoginKeyPair,
  decryptLoginPayload,
  randomState,
  type LoginKeyPair,
} from './login-crypto';

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface BrowserLoginOptions {
  webUrl: string;
  /** Returns false when no browser could be launched; the URL is printed either way. */
  openBrowser?: (url: string) => Promise<boolean>;
  /** Called once the local listener is up, with the URL to open and the code to compare. */
  onReady?: (info: { url: string; code: string; opened: boolean }) => void;
  timeoutMs?: number;
}

export interface BrowserLoginResult {
  token: string;
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The page that tells the user to go back to the terminal, on the dashboard they just used. */
export function donePageUrl(webUrl: string, status: 'success' | 'cancelled' | 'error'): string {
  return `${webUrl}/public/cli/done?status=${status}`;
}

export function authorizeUrl(webUrl: string, params: { port: number; state: string; publicKey: string }): string {
  const query = new URLSearchParams({
    port: String(params.port),
    state: params.state,
    key: params.publicKey,
  });
  return `${webUrl}/cli/login?${query.toString()}`;
}

/**
 * Opens the system browser without a shell, so nothing in the URL is ever
 * interpreted as a command. Windows uses rundll32 rather than `start` because
 * cmd treats the `&` between query parameters as a command separator.
 */
export function openInBrowser(url: string): Promise<boolean> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];

  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

interface CallbackOutcome {
  token?: string;
  error?: AuthError;
}

function handleCallback(url: URL, keyPair: LoginKeyPair, state: string): CallbackOutcome {
  if (url.searchParams.get('error')) {
    return { error: new AuthError('Login was cancelled in the browser.', 'Run `paubox auth login` to try again.') };
  }

  const epk = url.searchParams.get('epk');
  const iv = url.searchParams.get('iv');
  const ct = url.searchParams.get('ct');
  if (!epk || !iv || !ct) {
    return { error: new AuthError('The browser did not return a session.', 'Run `paubox auth login` again.') };
  }

  try {
    const payload = JSON.parse(decryptLoginPayload(keyPair, state, { epk, iv, ct })) as { token?: unknown };
    if (typeof payload.token !== 'string' || payload.token.length === 0) {
      throw new Error('missing token');
    }
    return { token: payload.token };
  } catch {
    return {
      error: new AuthError(
        'The session returned by the browser could not be read.',
        'Run `paubox auth login` again. If it keeps failing, the dashboard and CLI may be on different versions.',
      ),
    };
  }
}

/**
 * Runs the loopback login (RFC 8252 style): listen on a random 127.0.0.1 port,
 * send the browser to the dashboard's /cli/login page, and wait for it to
 * redirect back with the encrypted session.
 *
 * The listener accepts exactly one callback carrying the right state, then
 * closes. Anything else on the port gets a 404 and does not end the wait.
 */
export async function browserLogin(opts: BrowserLoginOptions): Promise<BrowserLoginResult> {
  const keyPair = createLoginKeyPair();
  const state = randomState();
  const timeoutMs = opts.timeoutMs ?? LOGIN_TIMEOUT_MS;

  let settle: (outcome: CallbackOutcome) => void = () => undefined;
  const outcome = new Promise<CallbackOutcome>((resolve) => {
    settle = resolve;
  });
  let settled = false;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback' || settled) {
      res.writeHead(404, { 'Content-Type': 'text/plain', Connection: 'close' });
      res.end('Not found');
      return;
    }

    // A callback with the wrong state is not ours to act on: answer it, keep waiting.
    if (!sameString(url.searchParams.get('state') ?? '', state)) {
      res.writeHead(400, { 'Content-Type': 'text/plain', Connection: 'close' });
      res.end('This login request has expired. Return to your terminal.');
      return;
    }

    const result = handleCallback(url, keyPair, state);
    settled = true;
    const status = result.token ? 'success' : url.searchParams.get('error') ? 'cancelled' : 'error';
    // Redirecting away also takes the encrypted payload out of the address bar.
    res.writeHead(302, { Location: donePageUrl(opts.webUrl, status), Connection: 'close' });
    res.end();
    settle(result);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const { port } = server.address() as AddressInfo;
  const url = authorizeUrl(opts.webUrl, { port, state, publicKey: keyPair.publicKey });
  const opened = opts.openBrowser ? await opts.openBrowser(url) : false;
  opts.onReady?.({ url, code: confirmationCode(keyPair.publicKey), opened });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CallbackOutcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          error: new AuthError(
            `Timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for the browser login.`,
            'Run `paubox auth login` again and finish in the window it opens.',
          ),
        }),
      timeoutMs,
    );
  });

  try {
    const result = await Promise.race([outcome, timeout]);
    if (result.error) throw result.error;
    return { token: result.token as string };
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
  }
}
