import { ApiError, AuthError, ConfigError } from './errors';
import type {
  BulkJobGetResponse,
  BulkJobListResponse,
  CampaignGetResponse,
  CampaignListResponse,
  GetCampaignParams,
  GetSubscriberParams,
  ListCampaignsParams,
  ListMarketingListsParams,
  ListSubscribersParams,
  MarketingAnalyticsParams,
  MarketingAnalyticsType,
  MarketingListsResponse,
  SubscribedCountParams,
  SubscribedCountResponse,
  SubscriberGetResponse,
  SubscriberListResponse,
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
