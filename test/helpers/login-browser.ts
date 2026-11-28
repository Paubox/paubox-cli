import { createCipheriv, createECDH, randomBytes } from 'crypto';
import { deriveLoginKey, type EncryptedLoginPayload } from '../../src/lib/login-crypto';

/**
 * The dashboard's half of the login scheme, written independently of the CLI's
 * decrypt so a mismatch between the two shows up as a failing test.
 */
export function encryptForCli(cliPublicKey: string, state: string, plaintext: string): EncryptedLoginPayload {
  const server = createECDH('prime256v1');
  server.generateKeys();
  const key = deriveLoginKey(server.computeSecret(Buffer.from(cliPublicKey, 'base64url')), state);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(state));
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {
    epk: server.getPublicKey().toString('base64url'),
    iv: iv.toString('base64url'),
    ct: sealed.toString('base64url'),
  };
}

/** What the /cli/login page does after Authorize: redirect to the CLI's listener. */
export function callbackUrl(authorizeUrl: string, extra: Record<string, string>): string {
  const params = new URL(authorizeUrl).searchParams;
  const query = new URLSearchParams({ state: params.get('state') ?? '', ...extra });
  return `http://127.0.0.1:${params.get('port')}/callback?${query.toString()}`;
}
