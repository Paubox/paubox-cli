import { authorizeUrl, browserLogin, donePageUrl } from '../../src/lib/browser-login';
import { AuthError } from '../../src/lib/errors';
import { confirmationCode, createLoginKeyPair } from '../../src/lib/login-crypto';
import { callbackUrl, encryptForCli } from '../helpers/login-browser';

const WEB_URL = 'https://local.paubox.net';

/** Starts a login and hands back the URL it would have opened, without a browser. */
async function startLogin(timeoutMs = 5000) {
  let resolveUrl: (value: { url: string; code: string; opened: boolean }) => void = () => undefined;
  const ready = new Promise<{ url: string; code: string; opened: boolean }>((resolve) => {
    resolveUrl = resolve;
  });
  const login = browserLogin({
    webUrl: WEB_URL,
    openBrowser: async () => true,
    onReady: (info) => resolveUrl(info),
    timeoutMs,
  });
  // Observed now, so a rejection that lands while the test is mid-fetch isn't unhandled.
  const failure = login.then(
    () => undefined,
    (err: unknown) => err,
  );
  return { login, failure, ready: await ready };
}

function authorizeParams(url: string) {
  const params = new URL(url).searchParams;
  return { state: params.get('state') ?? '', key: params.get('key') ?? '' };
}

describe('authorizeUrl', () => {
  it('points at /cli/login with the port, state and public key', () => {
    const url = new URL(authorizeUrl(WEB_URL, { port: 4321, state: 's', publicKey: 'k' }));
    expect(url.origin + url.pathname).toBe(`${WEB_URL}/cli/login`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ port: '4321', state: 's', key: 'k' });
  });
});

describe('browserLogin', () => {
  it('returns the token from an encrypted callback and redirects to the done page', async () => {
    const { login, ready } = await startLogin();
    const { state, key } = authorizeParams(ready.url);
    expect(ready.code).toBe(confirmationCode(key));
    expect(ready.opened).toBe(true);

    const payload = encryptForCli(key, state, JSON.stringify({ token: 'header.payload.sig' }));
    const response = await fetch(callbackUrl(ready.url, { ...payload }), { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(donePageUrl(WEB_URL, 'success'));
    await expect(login).resolves.toEqual({ token: 'header.payload.sig' });
  });

  it('ignores a callback with the wrong state and keeps waiting for the right one', async () => {
    const { login, ready } = await startLogin();
    const { state, key } = authorizeParams(ready.url);
    const port = new URL(ready.url).searchParams.get('port');

    const stray = await fetch(`http://127.0.0.1:${port}/callback?state=not-ours&error=access_denied`, {
      redirect: 'manual',
    });
    expect(stray.status).toBe(400);

    const payload = encryptForCli(key, state, JSON.stringify({ token: 't' }));
    await fetch(callbackUrl(ready.url, { ...payload }), { redirect: 'manual' });
    await expect(login).resolves.toEqual({ token: 't' });
  });

  it('answers other paths with 404', async () => {
    const { failure, ready } = await startLogin();
    const port = new URL(ready.url).searchParams.get('port');

    const response = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    expect(response.status).toBe(404);

    await fetch(callbackUrl(ready.url, { error: 'access_denied' }), { redirect: 'manual' });
    expect(String(await failure)).toContain('cancelled');
  });

  it('rejects with an AuthError when the user cancels in the browser', async () => {
    const { failure, ready } = await startLogin();
    const response = await fetch(callbackUrl(ready.url, { error: 'access_denied' }), { redirect: 'manual' });

    expect(response.headers.get('location')).toBe(donePageUrl(WEB_URL, 'cancelled'));
    expect(await failure).toBeInstanceOf(AuthError);
  });

  it('rejects when the payload cannot be decrypted', async () => {
    const { failure, ready } = await startLogin();
    const { state } = authorizeParams(ready.url);
    // Encrypted to someone else's key.
    const other = encryptForCli(createLoginKeyPair().publicKey, state, '{"token":"t"}');
    const response = await fetch(callbackUrl(ready.url, { ...other }), { redirect: 'manual' });

    expect(response.headers.get('location')).toBe(donePageUrl(WEB_URL, 'error'));
    expect(String(await failure)).toContain('could not be read');
  });

  it('times out when the browser never comes back', async () => {
    const { failure } = await startLogin(50);
    expect(String(await failure)).toContain('Timed out');
  });

  it('reports opened=false when no browser launcher is given', async () => {
    let opened: boolean | undefined;
    let url = '';
    const login = browserLogin({
      webUrl: WEB_URL,
      onReady: (info) => {
        opened = info.opened;
        url = info.url;
      },
      timeoutMs: 5000,
    });
    const failure = login.catch((err: unknown) => err);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toBe(false);

    await fetch(callbackUrl(url, { error: 'access_denied' }), { redirect: 'manual' });
    expect(await failure).toBeInstanceOf(AuthError);
  });
});
