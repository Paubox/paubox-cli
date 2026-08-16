export interface PauboxCredentials {
  apiKey: string;
  formsApiKey?: string;
}

export interface SendEmailOptions {
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: AttachmentOption[];
}

export interface AttachmentOption {
  fileName: string;
  contentType: string;
  content: string;
}

export interface PauboxMessagePayload {
  data: {
    message: {
      recipients: string[];
      headers: {
        subject: string;
        from: string;
        'reply-to': string;
      };
      content: {
        'text/plain'?: string;
        'text/html'?: string;
      };
      attachments?: AttachmentOption[];
    };
  };
}

export interface SendEmailResponse {
  sourceTrackingId: string;
  data: string;
}

export interface MessageDelivery {
  recipient: string;
  status: {
    deliveryStatus: string;
    deliveryTime: string;
    openedStatus: string;
    openedTime: string;
  };
}

export interface MessageStatusResponse {
  sourceTrackingId: string;
  data: {
    message: {
      id: string;
      message_deliveries: MessageDelivery[];
    };
  };
}

export interface ConfigData {
  defaultFrom?: string;
  [key: string]: string | undefined;
}

export interface FormGetResponse {
  id: string | number;
  title: string;
  description: string;
  active: boolean;
  submission_count: number;
  signable: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormSubmissionAttachment {
  fileName: string;
  contentType: string;
  content: string;
}

export interface FormSubmissionPayload {
  form_data: Record<string, string>;
  attachments?: FormSubmissionAttachment[];
}


export interface FormRecord {
  id: string;
  title: string;
  description: string | null;
  form_html: string | null;
  form_json: unknown;
  form_css: string | null;
  vanity_url: string | null;
  version: number;
  active: boolean;
  customer_id: number | null;
  old_form_id: string | null;
  created_at: string;
  updated_at: string;
  recipient: string | null;
  signable: boolean | null;
  signature_confirmation_label: string | null;
  submission_count: number | null;
  type: string | null;
  subscription_list_id: string | null;
  deleted: boolean | null;
  archived: boolean | null;
}

export interface ListFormsParams {
  customerId?: number;
  formId?: string;
  search?: string;
  archived?: boolean;
  active?: boolean;
  orderBy?: 'title' | 'updated_at' | 'submission_count' | 'created_at';
  order?: 'asc' | 'desc';
  page?: number;
  items?: number;
}

export interface PageInfo {
  count: number;
  pages: number;
  page: number;
  items: number;
}

export interface FormListResponse {
  results: FormRecord[];
  page_info: PageInfo;
}

export interface FormStatsResponse {
  active_form_count: number;
  total_submission_count: number;
  submissions_last_7_days: number;
}

export interface CreateFormBody {
  title: string;
  customer_id: number;
  form_json: unknown;
  version: number;
  description?: string;
  form_html?: string;
  form_css?: string;
  recipient?: string;
  signable?: boolean;
  signature_confirmation_label?: string;
  subscription_list_id?: string;
  type?: string;
  active?: boolean;
  submission_count?: number;
}

export interface UpdateFormBody {
  title?: string;
  description?: string;
  form_json?: unknown;
  vanity_url?: string;
  recipient?: string;
  active?: boolean;
  subscription_list_id?: string;
}

export interface SubmissionRecord {
  id: string;
  form_id: string;
  form_data: string;
  storage_type: string | null;
  storage_url: string | null;
  submitter_email: string | null;
  recipients: string | null;
  attachment_name: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  created_at: string;
}

export interface ListSubmissionsParams {
  page?: number;
  items?: number;
  orderBy?: 'created_at' | 'submitter_email';
  order?: 'asc' | 'desc';
  submissionId?: string;
}

export interface SubmissionListResponse {
  data: SubmissionRecord[];
  total: number;
  page: number;
  items: number;
}

export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}

// --- Marketing API (api.paubox.com/v1/marketing) ---
//
// The marketing endpoints serialize through fast_jsonapi, so collections come
// back as { data: [{ id, type, attributes }] } rather than flat records.

export interface JsonApiResource<A> {
  id: string;
  type: string;
  attributes: A;
}

export interface MarketingPageInfo {
  count?: number;
  pages?: number;
  page?: number;
  items?: number;
}

export interface SubscriberCustomField {
  subscriber_custom_field_type_id: string;
  name: string;
  value: unknown;
}

export interface SubscriberListMembership {
  id: number;
  name: string;
  unsubscribed: boolean;
}

export interface MarketingSubscriberAttributes {
  email: string;
  phone_number: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  created_at: string;
  updated_at: string;
  unsubscribed?: boolean;
  custom_fields?: SubscriberCustomField[];
  subscription_lists?: SubscriberListMembership[];
  statistics?: Record<string, unknown>;
}

export interface SubscriberListResponse {
  data: JsonApiResource<MarketingSubscriberAttributes>[];
  total_count?: number;
  search_after?: unknown[];
}

export interface SubscriberGetResponse {
  data: JsonApiResource<MarketingSubscriberAttributes> | null;
}

export interface SubscribedCountResponse {
  data: number;
}

export interface MarketingListAttributes {
  name: string;
  subscriber_count: number;
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
  form_id?: string | null;
  filters?: unknown;
  statistics?: Record<string, unknown>;
}

export interface MarketingListsResponse {
  data: JsonApiResource<MarketingListAttributes>[];
  page_info?: MarketingPageInfo;
}

export interface MarketingCampaignAttributes {
  subject: string | null;
  default_subject: string | null;
  template_type: string | null;
  created_at: string;
  updated_at: string;
  // `sent_count` is "N/A" (a string) when the backend cannot reconcile it
  // against delivered_count -- see CampaignMailingSerializer.
  sent_count?: number | string;
  delivered_count?: number;
  viewed_count?: number;
  clicked_count?: number;
  bounced_count?: number;
  unsubscribed_count?: number;
  form_data?: unknown;
  html_part?: string | null;
  text_part?: string | null;
  image_data?: unknown;
}

export interface CampaignListResponse {
  data: JsonApiResource<MarketingCampaignAttributes>[];
}

export interface CampaignGetResponse {
  data: JsonApiResource<MarketingCampaignAttributes> | null;
}

export interface BulkJobStatus {
  total_jobs: number | null;
  failures: number | null;
  pending: number | null;
}

export interface BulkJobListResponse {
  data: BulkJobStatus[];
}

export interface BulkJobGetResponse {
  data: BulkJobStatus;
}

export interface ListSubscribersParams {
  search?: string;
  orderBy?: string;
  order?: 'asc' | 'desc';
  page?: number;
  items?: number;
  subscriptionListId?: string;
  dynamicListId?: string;
}

export interface GetSubscriberParams {
  subscriptionListId?: string;
  dynamicListId?: string;
  withStats?: boolean;
}

export interface SubscribedCountParams {
  subscriptionListId?: string;
}

export interface ListMarketingListsParams {
  search?: string;
  orderBy?: string;
  order?: 'asc' | 'desc';
  page?: number;
  items?: number;
}

export interface ListCampaignsParams {
  search?: string;
  orderBy?: string;
  order?: 'asc' | 'desc';
  page?: number;
  templateType?: string;
}

export interface GetCampaignParams {
  withImages?: boolean;
}

// The controller derives the analytics report from the last path segment, so
// only these five resolve; a bare /analytics raises server-side.
export const MARKETING_ANALYTICS_TYPES = [
  'campaign_mailing_send_totals',
  'campaign_mailing_sends_table',
  'campaign_mailing_deliveries_table',
  'subscribers_by_tracking_link',
  'tracking_links_by_unique_link',
] as const;

export type MarketingAnalyticsType = (typeof MARKETING_ANALYTICS_TYPES)[number];

// --- Marketing write operations ---

export interface SubscriberCustomFieldInput {
  name: string;
  value: string;
}

// Any key here other than these four is treated as a custom field by
// SubscriberCreator, so the CLI sends custom fields explicitly rather than
// flattening them into the subscriber hash.
export interface SubscriberWriteData {
  email?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  custom_fields?: SubscriberCustomFieldInput[];
}

export interface SubscriberWriteBody {
  subscriber: SubscriberWriteData;
  subscription_list_id?: string;
}

export interface CsvExportResponse {
  data: {
    sent_to_email: string;
    jid: string;
  };
}

export interface ExportSubscribersCsvParams {
  email: string;
  fromSubscriptionListId?: string;
  search?: string;
  subscriberIds?: string[];
  exceptIds?: string[];
}

export interface ExportDynamicListCsvParams {
  email: string;
  dynamicListId: string;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

export interface SubscriptionChangeBody {
  subscriber_ids: string[];
  subscription_list_ids?: string[];
}

export interface MarketingListGetResponse {
  data: JsonApiResource<MarketingListAttributes> | null;
}

export interface ListListsParams {
  orderBy?: string;
  order?: 'asc' | 'desc';
  page?: number;
  items?: number;
  withStats?: boolean;
}

export interface DynamicListWriteBody {
  name?: string;
  // The API stores this as an opaque scalar, so it travels as a JSON string.
  filters?: string;
}

export interface MarketingAnalyticsParams {
  campaignMailingSendId?: string;
  campaignMailingId?: string;
  dripCampaignId?: string;
  emailType?: string;
  htmlId?: string;
  email?: string;
  search?: string;
  orderBy?: string;
  order?: 'asc' | 'desc';
  startDate?: string;
  endDate?: string;
  byDate?: boolean;
  dateOffset?: number;
  withStats?: boolean;
}
