import { ApiError, AuthError, ConfigError } from './errors';
import type {
  BulkJobGetResponse,
  BulkJobListResponse,
  CampaignGetResponse,
  CampaignListResponse,
  CsvExportResponse,
  DynamicListWriteBody,
  ExportDynamicListCsvParams,
  ExportSubscribersCsvParams,
  GetCampaignParams,
  GetSubscriberParams,
  ListCampaignsParams,
  ListListsParams,
  ListMarketingListsParams,
  ListSubscribersParams,
  MarketingAnalyticsParams,
  MarketingAnalyticsType,
  MarketingListGetResponse,
  MarketingListsResponse,
  SubscribedCountParams,
  SubscribedCountResponse,
  SubscriberGetResponse,
  SubscriberListResponse,
  SubscriberWriteBody,
  SubscriptionChangeBody,
} from '../types';

// The username-less marketing gateway. Unlike the legacy
// /v1/orca/:endpoint_username routes, this resolves the customer from the
// caller's email API key, so `paubox auth login` credentials work unchanged.
export const DEFAULT_MARKETING_BASE_URL = 'https://api.paubox.com/v1/marketing';

// Mirrors resolveFormsBaseUrl: the API key is sent to whatever host this
// returns, so the override is limited to http(s) origins. This guards against
// typos and unsupported schemes rather than acting as a trust boundary.
export function resolveMarketingBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PAUBOX_MARKETING_URL?.trim();
  if (!override) {
    return DEFAULT_MARKETING_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new ConfigError(
      `PAUBOX_MARKETING_URL is not a valid URL: ${override}`,
      `Use a full base URL including the scheme, e.g. ${DEFAULT_MARKETING_BASE_URL}.`,
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(
      `PAUBOX_MARKETING_URL must use http or https, got "${parsed.protocol}".`,
      `Use a full base URL including the scheme, e.g. ${DEFAULT_MARKETING_BASE_URL}.`,
    );
  }

  return override.replace(/\/+$/, '');
}

function sanitizePathSegment(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`${label} is required.`);
  }
  if (value === '.' || value === '..') {
    throw new ConfigError(
      `${label} cannot be "." or ".." — path-traversal segments are rejected.`,
    );
  }
  return encodeURIComponent(value);
}

type FetchFn = typeof fetch;

type QueryValue = string | number | boolean | undefined;

function buildQuery(pairs: Record<string, QueryValue>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(pairs)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

// The subscription_lists and dynamic_lists index endpoints share the same
// pagination contract as /lists: page_info only appears when opted in.
function listQuery(params: ListListsParams): string {
  const paginated = params.page !== undefined || params.items !== undefined;
  return buildQuery({
    order_by: params.orderBy,
    order: params.order,
    page: params.page,
    items: params.items,
    use_pagination: paginated ? true : undefined,
    with_stats: params.withStats === true ? 'true' : undefined,
  });
}

function formatApiErrors(errors: unknown): string {
  if (typeof errors === 'string') {
    return errors;
  }
  if (Array.isArray(errors)) {
    return errors
      .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
      .join('; ');
  }
  if (errors !== null && typeof errors === 'object') {
    return Object.entries(errors as Record<string, unknown>)
      .map(([field, messages]) =>
        Array.isArray(messages) ? `${field} ${messages.join(', ')}` : `${field} ${String(messages)}`,
      )
      .join('; ');
  }
  return String(errors);
}

function isEmptyErrors(errors: unknown): boolean {
  if (errors === undefined || errors === null || errors === '') return true;
  if (Array.isArray(errors)) return errors.length === 0;
  if (typeof errors === 'object') return Object.keys(errors as object).length === 0;
  return false;
}

function assertNoErrors(body: unknown): void {
  if (body === null || typeof body !== 'object') return;
  const errors = (body as { errors?: unknown }).errors;
  if (isEmptyErrors(errors)) return;
  throw new ApiError(
    `Request rejected: ${formatApiErrors(errors)}`,
    // The transport status really was 200 -- the rejection is in the body.
    200,
    'The Marketing API returned a validation error. Check the field values and try again.',
  );
}

export class MarketingApiClient {
  private readonly fetchFn: FetchFn;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(fetchFn?: FetchFn, apiKey?: string | null, baseUrl?: string) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
    this.apiKey = apiKey ?? null;
    this.baseUrl = baseUrl ?? resolveMarketingBaseUrl();
  }

  async listSubscribers(params: ListSubscribersParams): Promise<SubscriberListResponse> {
    const qs = buildQuery({
      search: params.search,
      order_by: params.orderBy,
      order: params.order,
      page: params.page,
      items: params.items,
      subscription_list_id: params.subscriptionListId,
      dynamic_list_id: params.dynamicListId,
    });
    return this.getJson<SubscriberListResponse>(`/subscribers${qs}`);
  }

  async getSubscriber(
    subscriberId: string,
    params: GetSubscriberParams = {},
  ): Promise<SubscriberGetResponse> {
    const safeId = sanitizePathSegment(subscriberId, 'subscriberId');
    const qs = buildQuery({
      subscription_list_id: params.subscriptionListId,
      dynamic_list_id: params.dynamicListId,
      // The serializer compares with_stats against the string "true", so a
      // bare boolean would silently drop the statistics block.
      with_stats: params.withStats === true ? 'true' : undefined,
    });
    return this.getJson<SubscriberGetResponse>(`/subscribers/${safeId}${qs}`);
  }

  async getSubscribedCount(params: SubscribedCountParams = {}): Promise<SubscribedCountResponse> {
    const qs = buildQuery({ subscription_list_id: params.subscriptionListId });
    return this.getJson<SubscribedCountResponse>(`/subscribers/subscribed_count${qs}`);
  }

  async listLists(params: ListMarketingListsParams): Promise<MarketingListsResponse> {
    const paginated = params.page !== undefined || params.items !== undefined;
    const qs = buildQuery({
      search: params.search,
      order_by: params.orderBy,
      order: params.order,
      page: params.page,
      items: params.items,
      // The endpoint only returns page_info when pagination is opted into, and
      // defaults to 10 items when it is. Only request it if the caller paged.
      use_pagination: paginated ? true : undefined,
    });
    return this.getJson<MarketingListsResponse>(`/lists${qs}`);
  }

  async listCampaigns(params: ListCampaignsParams): Promise<CampaignListResponse> {
    const qs = buildQuery({
      search: params.search,
      order_by: params.orderBy,
      order: params.order,
      page: params.page,
      template_type: params.templateType,
    });
    return this.getJson<CampaignListResponse>(`/campaign_mailings${qs}`);
  }

  async getCampaign(
    campaignId: string,
    params: GetCampaignParams = {},
  ): Promise<CampaignGetResponse> {
    const safeId = sanitizePathSegment(campaignId, 'campaignId');
    // The controller checks `params[:with_images].present?`, so the flag must be
    // omitted entirely rather than sent as "false".
    const qs = buildQuery({ with_images: params.withImages === true ? 'true' : undefined });
    return this.getJson<CampaignGetResponse>(`/campaign_mailings/${safeId}${qs}`);
  }

  async getAnalytics(
    type: MarketingAnalyticsType,
    params: MarketingAnalyticsParams = {},
  ): Promise<unknown> {
    const qs = buildQuery({
      campaign_mailing_send_id: params.campaignMailingSendId,
      campaign_mailing_id: params.campaignMailingId,
      drip_campaign_id: params.dripCampaignId,
      email_type: params.emailType,
      html_id: params.htmlId,
      email: params.email,
      search: params.search,
      order_by: params.orderBy,
      order: params.order,
      start_date: params.startDate,
      end_date: params.endDate,
      by_date: params.byDate === true ? 'true' : undefined,
      date_offset: params.dateOffset,
      with_stats: params.withStats === true ? 'true' : undefined,
    });
    return this.getJson<unknown>(`/analytics/${type}${qs}`);
  }

  async listBulkJobs(): Promise<BulkJobListResponse> {
    return this.getJson<BulkJobListResponse>('/bulk_jobs');
  }

  async getBulkJob(bid: string): Promise<BulkJobGetResponse> {
    const safeBid = sanitizePathSegment(bid, 'bid');
    return this.getJson<BulkJobGetResponse>(`/bulk_jobs/${safeBid}`);
  }

  // --- Writes ---

  async createSubscriber(body: SubscriberWriteBody): Promise<SubscriberGetResponse> {
    return this.sendJson<SubscriberGetResponse>('POST', '/subscribers', body);
  }

  async updateSubscriber(
    subscriberId: string,
    body: SubscriberWriteBody,
  ): Promise<SubscriberGetResponse> {
    const safeId = sanitizePathSegment(subscriberId, 'subscriberId');
    return this.sendJson<SubscriberGetResponse>('PATCH', `/subscribers/${safeId}`, body);
  }

  async exportSubscribersCsv(params: ExportSubscribersCsvParams): Promise<CsvExportResponse> {
    const body: Record<string, unknown> = { email: params.email };
    if (params.fromSubscriptionListId !== undefined) {
      body.from_subscription_list_id = params.fromSubscriptionListId;
    }
    if (params.search !== undefined) body.search = params.search;
    if (params.subscriberIds !== undefined) body.subscriber_ids = params.subscriberIds;
    if (params.exceptIds !== undefined) body.except_ids = params.exceptIds;
    return this.sendJson<CsvExportResponse>('POST', '/subscribers_export_csv', body);
  }

  async exportDynamicListCsv(params: ExportDynamicListCsvParams): Promise<CsvExportResponse> {
    const body: Record<string, unknown> = {
      email: params.email,
      dynamic_list_id: params.dynamicListId,
    };
    if (params.orderBy !== undefined) body.order_by = params.orderBy;
    if (params.order !== undefined) body.order = params.order;
    return this.sendJson<CsvExportResponse>('POST', '/export_dynamic_list_csv', body);
  }

  async subscribe(body: SubscriptionChangeBody): Promise<SubscriberListResponse> {
    return this.sendJson<SubscriberListResponse>('POST', '/subscriptions/subscribe', body);
  }

  async unsubscribe(body: SubscriptionChangeBody): Promise<SubscriberListResponse> {
    return this.sendJson<SubscriberListResponse>('POST', '/subscriptions/unsubscribe', body);
  }

  // --- Subscription lists ---

  async listSubscriptionLists(params: ListListsParams): Promise<MarketingListsResponse> {
    return this.getJson<MarketingListsResponse>(`/subscription_lists${listQuery(params)}`);
  }

  async getSubscriptionList(
    listId: string,
    params: { withStats?: boolean } = {},
  ): Promise<MarketingListGetResponse> {
    const safeId = sanitizePathSegment(listId, 'listId');
    const qs = buildQuery({ with_stats: params.withStats === true ? 'true' : undefined });
    return this.getJson<MarketingListGetResponse>(`/subscription_lists/${safeId}${qs}`);
  }

  async createSubscriptionList(name: string): Promise<MarketingListGetResponse> {
    return this.sendJson<MarketingListGetResponse>('POST', '/subscription_lists', { name });
  }

  async updateSubscriptionList(listId: string, name: string): Promise<MarketingListGetResponse> {
    const safeId = sanitizePathSegment(listId, 'listId');
    return this.sendJson<MarketingListGetResponse>('PATCH', `/subscription_lists/${safeId}`, {
      name,
    });
  }

  async deleteSubscriptionList(listId: string): Promise<void> {
    const safeId = sanitizePathSegment(listId, 'listId');
    await this.sendJson<unknown>('DELETE', `/subscription_lists/${safeId}`);
  }

  // --- Dynamic lists ---

  async listDynamicLists(params: ListListsParams): Promise<MarketingListsResponse> {
    return this.getJson<MarketingListsResponse>(`/dynamic_lists${listQuery(params)}`);
  }

  async getDynamicList(
    listId: string,
    params: { withStats?: boolean } = {},
  ): Promise<MarketingListGetResponse> {
    const safeId = sanitizePathSegment(listId, 'listId');
    const qs = buildQuery({ with_stats: params.withStats === true ? 'true' : undefined });
    return this.getJson<MarketingListGetResponse>(`/dynamic_lists/${safeId}${qs}`);
  }

  async createDynamicList(body: DynamicListWriteBody): Promise<MarketingListGetResponse> {
    return this.sendJson<MarketingListGetResponse>('POST', '/dynamic_lists', body);
  }

  async updateDynamicList(
    listId: string,
    body: DynamicListWriteBody,
  ): Promise<MarketingListGetResponse> {
    const safeId = sanitizePathSegment(listId, 'listId');
    return this.sendJson<MarketingListGetResponse>('PATCH', `/dynamic_lists/${safeId}`, body);
  }

  async deleteDynamicList(listId: string): Promise<void> {
    const safeId = sanitizePathSegment(listId, 'listId');
    await this.sendJson<unknown>('DELETE', `/dynamic_lists/${safeId}`);
  }

  private async sendJson<T>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const init: RequestInit = { method, headers: this.authHeaders() };
    if (body !== undefined) {
      init.headers = { ...this.authHeaders(), 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchFn(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      await this.handleError(response);
    }

    const text = await response.text();
    if (text.trim() === '') {
      return undefined as T;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(`Unexpected non-JSON response: ${text}`, response.status);
    }

    // Validation failures on these endpoints come back as HTTP 200 with an
    // `errors` key rather than a 4xx, so a bare status check would report
    // a rejected write as a success.
    assertNoErrors(parsed);
    return parsed as T;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
    return response.json() as Promise<T>;
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new AuthError(
        'No Paubox API key configured.',
        'Run `paubox auth login` to store your API key.',
      );
    }
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async handleError(response: Response): Promise<never> {
    if (response.status === 401) {
      throw new AuthError(
        'Paubox API key is invalid or not authorized for the Marketing API.',
        'Run `paubox auth login` to re-authenticate.',
      );
    }

    const body = await response.text();

    if (response.status === 403) {
      throw new ApiError(
        `Forbidden (403): ${body}`,
        403,
        'Check that your plan includes Paubox Marketing.',
      );
    }

    if (response.status === 404) {
      // The gateway returns 404 both for an account with no marketing customer
      // record and for a missing resource. The body distinguishes them.
      if (body.includes('Customer Not Found')) {
        throw new ApiError(
          'No Paubox Marketing account is associated with this API key.',
          404,
          'Confirm Paubox Marketing is enabled for your account, then try again.',
        );
      }
      throw new ApiError('Resource not found.', 404, 'Check the ID and try again.');
    }

    throw new ApiError(`Request failed (${response.status}): ${body}`, response.status);
  }
}
