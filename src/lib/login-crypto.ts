import { createECDH, createDecipheriv, createHash, hkdfSync, randomBytes, type ECDH } from 'crypto';

/**
 * The browser hands the CLI its session through a redirect to 127.0.0.1, so the
 * payload lands in the browser's history. It is encrypted to a key pair that
 * exists only in this CLI process, which makes that history entry useless to
 * anyone who reads it later.
 *
 * Scheme v1, mirrored in paubox-next (src/utils/cliLogin.ts):
 *   ECDH P-256 between the CLI's key and a one-off server key
 *   -> HKDF-SHA256(salt = state, info = "paubox-cli-login/v1", 32 bytes)
 *   -> AES-256-GCM, 12-byte IV, AAD = state, ciphertext followed by the 16-byte tag.
 * Public keys are uncompressed points; every binary value travels as base64url.
 */
export const LOGIN_SCHEME_INFO = 'paubox-cli-login/v1';

const CURVE = 'prime256v1';
const TAG_BYTES = 16;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface LoginKeyPair {
  ecdh: ECDH;
  /** Uncompressed P-256 point, base64url. */
  publicKey: string;
}

export interface EncryptedLoginPayload {
  /** The server's one-off public key, base64url. */
  epk: string;
  iv: string;
  ct: string;
}

export function createLoginKeyPair(): LoginKeyPair {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  return { ecdh, publicKey: ecdh.getPublicKey().toString('base64url') };
}

export function randomState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Shown in the terminal and on the authorize page so the user can see the page is
 * talking to this terminal. Derived from the public key, so both sides compute it
 * without exchanging anything extra.
 */
export function confirmationCode(publicKey: string): string {
  const digest = createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest();
  const chars = Array.from(digest.subarray(0, 8), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function deriveLoginKey(sharedSecret: Buffer, state: string): Buffer {
  return Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.from(state), Buffer.from(LOGIN_SCHEME_INFO), 32));
}

/** Throws on any tampering, a wrong state, or a payload meant for another key. */
export function decryptLoginPayload(keyPair: LoginKeyPair, state: string, payload: EncryptedLoginPayload): string {
  const shared = keyPair.ecdh.computeSecret(Buffer.from(payload.epk, 'base64url'));
  const key = deriveLoginKey(shared, state);
  const iv = Buffer.from(payload.iv, 'base64url');
  const sealed = Buffer.from(payload.ct, 'base64url');
  if (iv.length !== 12 || sealed.length <= TAG_BYTES) {
    throw new Error('Malformed login payload.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(state));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]).toString(
    'utf8',
  );
}
