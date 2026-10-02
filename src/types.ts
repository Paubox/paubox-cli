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

export interface ScheduleEmailOptions extends SendEmailOptions {
  scheduledAt: string;
}

export interface ScheduleEmailResponse {
  sourceTrackingId: string;
  scheduledAt: string;
  state: string;
  data: string;
}

export interface ScheduledMessageResponse {
  sourceTrackingId: string;
  scheduledAt: string;
  state: string;
  data?: string;
  errors?: unknown;
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

export interface DataResponse<T> {
  data: T;
}

export interface ReceivingDomain {
  id: number;
  domain: string;
  [key: string]: unknown;
}

export interface ReceivingMailbox {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface ReceivedEmailAddress {
  name: string | null;
  address: string | null;
}

export interface ReceivedEmailAttachment {
  id: string;
  filename: string | null;
  content_type: string | null;
  size: number | null;
  content_id: string | null;
  download_url: string;
}

export interface ReceivedEmailSummary {
  email_id: string;
  from: ReceivedEmailAddress[];
  to: ReceivedEmailAddress[];
  subject: string | null;
  received_at: string | null;
  has_attachment: boolean | null;
  spam: boolean;
  size: number | null;
  domain: string;
}

export interface ReceivedEmailList {
  object: 'list';
  data: ReceivedEmailSummary[];
  has_more: boolean;
}

export interface ReceivedEmail {
  email_id: string;
  from: ReceivedEmailAddress[];
  to: ReceivedEmailAddress[];
  cc: ReceivedEmailAddress[];
  subject: string | null;
  date: string | null;
  received_at: string | null;
  message_id: string[] | null;
  in_reply_to: string[] | null;
  references: string[] | null;
  spam: boolean;
  spam_score: number | null;
  text_body: string | null;
  html_body: string | null;
  attachments: ReceivedEmailAttachment[];
  size: number | null;
  authentication: { spf: string; dkim: string; dmarc: string };
  domain: string;
  headers: { name: string; value: string }[] | null;
}

export interface DownloadedAttachment {
  data: Buffer;
  filename: string | null;
  contentType: string | null;
}

export interface ListReceivedEmailsParams {
  limit?: number;
  after?: string;
  before?: string;
}

export interface CreateMailboxOptions {
  name: string;
  password: string;
  quota_bytes?: number;
}

export interface WebhookEndpoint {
  id: number;
  target_url: string;
  events: string[];
  active: boolean;
  signing_key: string | null;
  api_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEndpointResponse {
  message: string;
  data: WebhookEndpoint;
}
