import { AuthError } from '../../src/lib/errors';
import { IamClient, tokenExpiry } from '../../src/lib/iam-api';
import { fakeResponse } from '../helpers/fake-response';

const IAM = 'https://api.staging.paubox.net/iam';

function jwtWith(payload: object): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
}

describe('IamClient', () => {
  it('reads entitlements with the session as a bearer token', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(200, { id: 7, email: 'jerry@paubox.com', mfa_verified: true }));
    const client = new IamClient(IAM, 'session.jwt', fetchFn);

    await expect(client.getEntitlements()).resolves.toEqual(expect.objectContaining({ id: 7 }));

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${IAM}/v1/token_entitlements`);
    expect(init.headers.Authorization).toBe('Bearer session.jwt');
    expect(init.headers['X-Paubox-Client']).toBe('paubox-cli');
  });

  it('turns a 401 into a login-expired AuthError', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(401, { error: 'Token has been revoked' }));
    const err = await new IamClient(IAM, 't', fetchFn).getEntitlements().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toContain('login session has expired or was revoked');
    expect((err as AuthError).suggestion).toContain('paubox auth login');
  });

  it('explains a 403 as unfinished MFA', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(403, { id: 7, mfa_verified: false }));
    const err = await new IamClient(IAM, 't', fetchFn).getEntitlements().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).suggestion).toContain('MFA');
  });

  it('signs out with DELETE /v2/users/sign_out', async () => {
    const fetchFn = jest.fn().mockResolvedValue(fakeResponse(200, { msg: 'Logged out' }));
    await new IamClient(IAM, 'session.jwt', fetchFn).signOut();

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${IAM}/v2/users/sign_out`);
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer session.jwt');
  });
});

describe('tokenExpiry', () => {
  it('reads the exp claim', () => {
    expect(tokenExpiry(jwtWith({ exp: 1_800_000_000 }))?.toISOString()).toBe('2027-01-15T08:00:00.000Z');
  });

  it('returns null for a token without exp or that is not a JWT', () => {
    expect(tokenExpiry(jwtWith({ uid: 1 }))).toBeNull();
    expect(tokenExpiry('not-a-jwt')).toBeNull();
  });
});
