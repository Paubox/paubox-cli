import {
  confirmationCode,
  createLoginKeyPair,
  decryptLoginPayload,
  randomState,
} from '../../src/lib/login-crypto';
import { encryptForCli } from '../helpers/login-browser';

describe('login-crypto', () => {
  it('decrypts what the dashboard encrypted to its public key', () => {
    const keyPair = createLoginKeyPair();
    const state = randomState();
    const payload = encryptForCli(keyPair.publicKey, state, JSON.stringify({ token: 'jwt.value.here' }));

    expect(JSON.parse(decryptLoginPayload(keyPair, state, payload))).toEqual({ token: 'jwt.value.here' });
  });

  it('publishes an uncompressed P-256 point', () => {
    const { publicKey } = createLoginKeyPair();
    const bytes = Buffer.from(publicKey, 'base64url');
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });

  it('rejects a payload bound to a different state', () => {
    const keyPair = createLoginKeyPair();
    const payload = encryptForCli(keyPair.publicKey, randomState(), '{"token":"x"}');

    expect(() => decryptLoginPayload(keyPair, randomState(), payload)).toThrow();
  });

  it('rejects a payload encrypted for another key', () => {
    const state = randomState();
    const payload = encryptForCli(createLoginKeyPair().publicKey, state, '{"token":"x"}');

    expect(() => decryptLoginPayload(createLoginKeyPair(), state, payload)).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const keyPair = createLoginKeyPair();
    const state = randomState();
    const payload = encryptForCli(keyPair.publicKey, state, '{"token":"x"}');
    const sealed = Buffer.from(payload.ct, 'base64url');
    sealed[0] ^= 0xff;

    expect(() => decryptLoginPayload(keyPair, state, { ...payload, ct: sealed.toString('base64url') })).toThrow();
  });

  it('rejects a malformed IV', () => {
    const keyPair = createLoginKeyPair();
    const state = randomState();
    const payload = encryptForCli(keyPair.publicKey, state, '{"token":"x"}');

    expect(() => decryptLoginPayload(keyPair, state, { ...payload, iv: 'AAAA' })).toThrow('Malformed');
  });

  it('derives a stable XXXX-XXXX confirmation code from the public key', () => {
    const { publicKey } = createLoginKeyPair();
    const code = confirmationCode(publicKey);

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(confirmationCode(publicKey)).toBe(code);
  });

  it('matches the confirmation code the dashboard computes for a known key', () => {
    // Pinned so a change on either side (alphabet, digest, slicing) is caught.
    // paubox-next's src/utils/cliLogin.test.ts asserts the same pair.
    const publicKey =
      'BEj4_CDZHGsvmDzYmN8jc97JOdeeeSfiILGvGm6sEmffuxobfHuWKtwhRGUKDslAE1s8W44MpyIWPS9W4Zrkhws';
    expect(confirmationCode(publicKey)).toBe('LDUC-3LG7');
  });
});
