import { ApiError, AuthError, ConfigError } from './errors';
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

// The only event an API key can subscribe to today. The webhooks service maps
// the `forms` scope and nothing else, so an Email API event is refused with a
// 403 no matter which key is used.
export const FORMS_EVENTS = ['forms.submission.created'] as const;

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

type FetchFn = typeof fetch;

export class WebhooksApiClient {
  private readonly fetchFn: FetchFn;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(fetchFn?: FetchFn, apiKey?: string | null, baseUrl?: string) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
    this.apiKey = apiKey ?? null;
    this.baseUrl = baseUrl ?? resolveWebhooksBaseUrl();
  }

  async listSubscriptions(
    params: ListWebhookSubscriptionsParams = {},
  ): Promise<WebhookSubscriptionListResponse> {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.items !== undefined) query.set('items', String(params.items));

    const qs = query.toString();
    const url = `${this.baseUrl}/endpoints${qs ? `?${qs}` : ''}`;
    const response = await this.fetchFn(url, { headers: this.authHeaders() });

    if (!response.ok) {
      await this.handleError(response);
    }
    return response.json() as Promise<WebhookSubscriptionListResponse>;
  }

  async getSubscription(id: string): Promise<WebhookSubscription> {
    const url = `${this.baseUrl}/endpoints/${sanitizeId(id)}`;
    const response = await this.fetchFn(url, { headers: this.authHeaders() });

    if (!response.ok) {
      await this.handleError(response);
    }
    const body = (await response.json()) as WebhookSubscriptionResponse;
    return body.data;
  }

  // The response carries `signing_secret`, which the service never returns
  // again — callers must surface it rather than discarding it.
  async createSubscription(
    body: CreateWebhookSubscriptionBody,
  ): Promise<CreatedWebhookSubscription> {
    const url = `${this.baseUrl}/endpoints`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
    const parsed = (await response.json()) as CreatedWebhookSubscriptionResponse;
    return parsed.data;
  }

  async updateSubscription(
    id: string,
    changes: UpdateWebhookSubscriptionBody,
  ): Promise<WebhookSubscription> {
    const url = `${this.baseUrl}/endpoints/${sanitizeId(id)}`;
    const response = await this.fetchFn(url, {
      method: 'PATCH',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
    const body = (await response.json()) as WebhookSubscriptionResponse;
    return body.data;
  }

  async deleteSubscription(id: string): Promise<void> {
    const url = `${this.baseUrl}/endpoints/${sanitizeId(id)}`;
    const response = await this.fetchFn(url, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new AuthError(
        'No Forms API key configured.',
        'Run `paubox auth set-forms-key` with a scoped API key that has the "forms" scope.',
      );
    }
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  // Errors arrive as {"message": "..."}; the raw body is the fallback so an
  // unexpected shape still reaches the user instead of becoming "undefined".
  private async errorMessage(response: Response): Promise<string> {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as { message?: unknown };
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // fall through
    }
    return body;
  }

  private async handleError(response: Response): Promise<never> {
    if (response.status === 401) {
      throw new AuthError(
        'Forms API key is invalid or lacks the "forms" scope.',
        'Run `paubox auth set-forms-key` with a scoped API key that has the "forms" scope.',
      );
    }

    const message = await this.errorMessage(response);

    if (response.status === 403) {
      throw new ApiError(
        `Forbidden (403): ${message}`,
        403,
        `An API key can only manage subscriptions to: ${FORMS_EVENTS.join(', ')}.`,
      );
    }
    if (response.status === 404) {
      throw new ApiError(
        'Webhook subscription not found.',
        404,
        'Run `paubox forms webhooks list` to see the subscriptions on this account.',
      );
    }
    if (response.status === 422) {
      throw new ApiError(
        `Validation failed: ${message}`,
        422,
        'target_url must be an https URL resolving to a public address, and every event must be one you are scoped for.',
      );
    }
    throw new ApiError(`Request failed (${response.status}): ${message}`, response.status);
  }
}
