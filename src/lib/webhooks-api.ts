import { AuthError, ConfigError } from './errors';
import { HttpClient } from './http';
import type { FetchFn } from './http';
import type {
  CreateWebhookSubscriptionBody,
  CreatedWebhookSubscription,
  CreatedWebhookSubscriptionResponse,
  ListWebhookSubscriptionsParams,
  UpdateWebhookSubscriptionBody,
  WebhookSubscription,
  WebhookSubscriptionListResponse,
  WebhookSubscriptionResponse,
} from '../types';

// The public gateway exposes only `/v1/webhooks/endpoints`; the ingest route
// producers post to is deliberately not reachable from this host.
export const DEFAULT_WEBHOOKS_BASE_URL = 'https://api.paubox.com/v1/webhooks';

/**
 * The events the service catalogues, for help text and error hints only.
 *
 * Deliberately not used to validate `--events`: the catalog lives in the
 * service and can grow without a CLI release, so an unrecognised name should
 * come back as the service's 422 rather than be refused here.
 *
 * The four Email API events keep their legacy `api_mail_log_` names so that
 * receivers written against the retired Email API webhooks keep working. Those
 * are the names on the wire — `delivered` or `failed` alone are rejected.
 */
export const WEBHOOK_EVENTS = [
  'forms.submission.created',
  'api_mail_log_delivered',
  'api_mail_log_opened',
  'api_mail_log_temporary_failure',
  'api_mail_log_permanent_failure',
  'email.inbound.received',
] as const;

// Same reasoning as the Forms client: the API key travels to whatever this
// resolves to, so the override is limited to http(s) origins as a guard against
// typos rather than as a trust boundary.
export function resolveWebhooksBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PAUBOX_WEBHOOKS_URL?.trim();
  if (!override) {
    return DEFAULT_WEBHOOKS_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new ConfigError(
      `PAUBOX_WEBHOOKS_URL is not a valid URL: ${override}`,
      `Use a full base URL including the scheme, e.g. ${DEFAULT_WEBHOOKS_BASE_URL}.`,
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(
      `PAUBOX_WEBHOOKS_URL must use http or https, got "${parsed.protocol}".`,
      `Use a full base URL including the scheme, e.g. ${DEFAULT_WEBHOOKS_BASE_URL}.`,
    );
  }

  return override.replace(/\/+$/, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeId(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError('subscriptionId is required.');
  }
  if (!UUID_RE.test(value)) {
    throw new ConfigError(
      `subscriptionId must be a UUID. Got "${value}".`,
      'Run `paubox forms webhooks list` to see the IDs you can use.',
    );
  }
  return encodeURIComponent(value);
}

const NOT_FOUND_HINT =
  'Run `paubox webhooks list` to see the subscriptions on this account.';

const VALIDATION_HINT =
  'target_url must be an https URL that resolves to a public address, and every ' +
  `event must be one your key is scoped for. Known events: ${WEBHOOK_EVENTS.join(', ')}.`;

export class WebhooksApiClient {
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly http: HttpClient;

  constructor(fetchFn?: FetchFn, apiKey?: string | null, baseUrl?: string) {
    this.apiKey = apiKey ?? null;
    this.baseUrl = baseUrl ?? resolveWebhooksBaseUrl();
    this.http = new HttpClient({
      service: 'webhooks',
      fetchFn,
      authHeaders: () => this.authHeaders(),
    });
  }

  private webhooksRequest(
    url: string,
    init: RequestInit | undefined,
    operation: string,
  ): Promise<Response> {
    return this.http.request(url, init ?? {}, {
      operation,
      hints: { 404: NOT_FOUND_HINT, 422: VALIDATION_HINT },
    });
  }

  async listSubscriptions(
    params: ListWebhookSubscriptionsParams = {},
  ): Promise<WebhookSubscriptionListResponse> {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.items !== undefined) query.set('items', String(params.items));

    const qs = query.toString();
    const url = `${this.baseUrl}/endpoints${qs ? `?${qs}` : ''}`;
    const response = await this.webhooksRequest(url, undefined, 'List webhook subscriptions');
    return response.json() as Promise<WebhookSubscriptionListResponse>;
  }

  async getSubscription(id: string): Promise<WebhookSubscription> {
    const url = `${this.baseUrl}/endpoints/${sanitizeId(id)}`;
    const response = await this.webhooksRequest(url, undefined, 'Get webhook subscription');
    const body = (await response.json()) as WebhookSubscriptionResponse;
    return body.data;
  }

  // The response carries `signing_secret`, which the service never returns
  // again — callers must surface it rather than discarding it.
  async createSubscription(
    body: CreateWebhookSubscriptionBody,
  ): Promise<CreatedWebhookSubscription> {
    const url = `${this.baseUrl}/endpoints`;
    const response = await this.webhooksRequest(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Create webhook subscription',
    );
    const parsed = (await response.json()) as CreatedWebhookSubscriptionResponse;
    return parsed.data;
  }

  async updateSubscription(
    id: string,
    changes: UpdateWebhookSubscriptionBody,
  ): Promise<WebhookSubscription> {
    const url = `${this.baseUrl}/endpoints/${sanitizeId(id)}`;
    const response = await this.webhooksRequest(
      url,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) },
      'Update webhook subscription',
    );
    const body = (await response.json()) as WebhookSubscriptionResponse;
    return body.data;
  }

  async deleteSubscription(id: string): Promise<void> {
    const url = `${this.baseUrl}/endpoints/${sanitizeId(id)}`;
    await this.webhooksRequest(url, { method: 'DELETE' }, 'Delete webhook subscription');
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw AuthError.missing('forms');
    }
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}
