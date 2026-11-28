import { HttpClient, type FetchFn } from './http';

/** The fields of IAM's token_entitlements response the CLI uses. */
export interface TokenEntitlements {
  id: number;
  name: string;
  email: string;
  customer_id?: number | null;
  customer: string | null;
  roles: string[];
  mfa_verified: boolean;
}

/**
 * IAM, called with a user session rather than an API key. Its routes accept the
 * session as `Authorization: Bearer <token>`, the same way the dashboard's
 * middleware presents the session cookie.
 */
export class IamClient {
  private readonly http: HttpClient;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    fetchFn?: FetchFn,
  ) {
    this.http = new HttpClient({
      service: 'account',
      fetchFn,
      authHeaders: () => ({ Authorization: `Bearer ${this.token}` }),
    });
  }

  async getEntitlements(): Promise<TokenEntitlements> {
    const response = await this.http.request(
      `${this.baseUrl}/v1/token_entitlements`,
      {},
      {
        operation: 'Check login session',
        hints: { 403: 'This session has not completed MFA. Run `paubox auth login` and finish MFA in the browser.' },
      },
    );
    return response.json() as Promise<TokenEntitlements>;
  }

  /** Revokes this session at IAM; other sessions for the same user are untouched. */
  async signOut(): Promise<void> {
    await this.http.request(
      `${this.baseUrl}/v2/users/sign_out`,
      { method: 'DELETE' },
      { operation: 'Revoke login session', idempotent: true },
    );
  }
}

/** The `exp` claim of a JWT, without verifying it: IAM does that on every call. */
export function tokenExpiry(token: string): Date | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}
