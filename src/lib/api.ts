import * as fs from 'fs';
import * as path from 'path';
import { AuthError, ValidationError } from './errors';
import { HttpClient } from './http';
import type { FetchFn } from './http';
import type {
  AttachmentOption,
  CreateMailboxOptions,
  DataResponse,
  DownloadedAttachment,
  ListReceivedEmailsParams,
  MessageStatusResponse,
  PauboxCredentials,
  PauboxMessagePayload,
  ReceivedEmail,
  ReceivedEmailList,
  ReceivingDomain,
  ReceivingMailbox,
  ScheduleEmailOptions,
  ScheduleEmailResponse,
  ScheduledMessageResponse,
  SendEmailOptions,
  SendEmailResponse,
} from '../types';

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  txt: 'text/plain',
  html: 'text/html',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

const STALE_EMAIL_ID_HINT =
  'Received emails are identified by their Paubox email_id (a UUID); older mail-server ids no longer resolve. Run `paubox receiving emails list` to find it.';
const STALE_ATTACHMENT_ID_HINT =
  'Attachments are identified by their Paubox attachment id (a UUID); older blob ids no longer resolve. Run `paubox receiving emails get <emailId>` to list them.';

function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(header);
  const filename = (match?.[1] ?? match?.[2] ?? '').trim();
  return filename === '' ? null : filename;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export function resolveAttachments(filePaths: string[]): AttachmentOption[] {
  const missing = filePaths.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    throw new ValidationError(
      missing.length === 1
        ? `Attachment not found: ${missing[0]}`
        : `${missing.length} attachments not found.`,
      'Check the paths passed to --attachment. Nothing was sent.',
      missing.map((filePath) => `--attachment: ${filePath} does not exist`),
    );
  }

  return filePaths.map((filePath) => {
    if (fs.statSync(filePath).isDirectory()) {
      throw new ValidationError(
        `Attachment is a directory: ${filePath}`,
        'Pass a file to --attachment, not a directory.',
      );
    }
    return {
      fileName: path.basename(filePath),
      contentType: getMimeType(filePath),
      content: fs.readFileSync(filePath).toString('base64'),
    };
  });
}

function buildPayload(options: SendEmailOptions): PauboxMessagePayload {
  const content: PauboxMessagePayload['data']['message']['content'] = {};
  if (options.text) content['text/plain'] = options.text;
  if (options.html) content['text/html'] = options.html;

  return {
    data: {
      message: {
        recipients: options.to,
        headers: {
          subject: options.subject,
          from: options.from,
          'reply-to': options.from,
        },
        content,
        ...(options.attachments?.length ? { attachments: options.attachments } : {}),
      },
    },
  };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class PauboxApiClient {
  private readonly baseUrl: string;
  private readonly http: HttpClient;

  constructor(private readonly credentials: PauboxCredentials, fetchFn?: FetchFn) {
    this.baseUrl = 'https://api.paubox.com/v1/email';
    this.http = new HttpClient({
      service: 'email',
      fetchFn,
      authHeaders: () => this.authHeaders(),
    });
  }

  /**
   * `auth set-forms-key` can store an empty `apiKey`, so an absent Email API key
   * is a normal state rather than a corrupt one — catch it here with the right
   * remedy instead of sending `Token token=` and reading back a bare 401.
   */
  private authHeaders(): Record<string, string> {
    if (!this.credentials.apiKey) {
      throw AuthError.missing('email');
    }
    return { Authorization: `Token token=${this.credentials.apiKey}` };
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResponse> {
    const response = await this.http.request(
      `${this.baseUrl}/messages`,
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(buildPayload(options)) },
      { operation: 'Send email' },
    );
    return response.json() as Promise<SendEmailResponse>;
  }

  async getMessageStatus(sourceTrackingId: string): Promise<MessageStatusResponse> {
    const response = await this.http.request(
      `${this.baseUrl}/message_receipt?sourceTrackingId=${encodeURIComponent(sourceTrackingId)}`,
      {},
      {
        operation: 'Status check',
        hints: {
          404: 'No message with that tracking ID. Check the value returned by `paubox send`.',
        },
      },
    );
    return response.json() as Promise<MessageStatusResponse>;
  }

  async scheduleEmail(options: ScheduleEmailOptions): Promise<ScheduleEmailResponse> {
    const payload = buildPayload(options);
    const response = await this.http.request(
      `${this.baseUrl}/schedule`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ data: { ...payload.data, scheduled_at: options.scheduledAt } }),
      },
      { operation: 'Schedule email' },
    );
    return response.json() as Promise<ScheduleEmailResponse>;
  }

  async getScheduledMessage(sourceTrackingId: string): Promise<ScheduledMessageResponse> {
    const response = await this.http.request(
      `${this.baseUrl}/schedule/${encodeURIComponent(sourceTrackingId)}`,
      {},
      {
        operation: 'Get scheduled message',
        hints: { 404: 'No scheduled message with that tracking ID — it may have already been sent or cancelled.' },
      },
    );
    return response.json() as Promise<ScheduledMessageResponse>;
  }

  async rescheduleMessage(
    sourceTrackingId: string,
    scheduledAt: string,
  ): Promise<ScheduledMessageResponse> {
    const response = await this.http.request(
      `${this.baseUrl}/schedule/${encodeURIComponent(sourceTrackingId)}`,
      { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ scheduled_at: scheduledAt }) },
      {
        operation: 'Reschedule message',
        hints: { 404: 'No scheduled message with that tracking ID — it may have already been sent or cancelled.' },
      },
    );
    return response.json() as Promise<ScheduledMessageResponse>;
  }

  async cancelScheduledMessage(sourceTrackingId: string): Promise<ScheduledMessageResponse> {
    const response = await this.http.request(
      `${this.baseUrl}/schedule/${encodeURIComponent(sourceTrackingId)}/cancel`,
      { method: 'POST' },
      {
        operation: 'Cancel scheduled message',
        hints: { 404: 'No scheduled message with that tracking ID — it may have already been sent or cancelled.' },
      },
    );
    return response.json() as Promise<ScheduledMessageResponse>;
  }

  private receivingRequest(
    path: string,
    init: RequestInit | undefined,
    operation: string,
    notFoundSuggestion?: string,
  ): Promise<Response> {
    return this.http.request(`${this.baseUrl}${path}`, init ?? {}, {
      operation,
      ...(notFoundSuggestion ? { hints: { 404: notFoundSuggestion } } : {}),
    });
  }

  async listReceivingDomains(): Promise<DataResponse<ReceivingDomain[]>> {
    const response = await this.receivingRequest('/receiving/domains', undefined, 'List receiving domains');
    return response.json() as Promise<DataResponse<ReceivingDomain[]>>;
  }

  async createReceivingDomain(slug?: string): Promise<DataResponse<ReceivingDomain>> {
    const response = await this.receivingRequest(
      '/receiving/domains',
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(slug !== undefined ? { slug } : {}),
      },
      'Create receiving domain',
    );
    return response.json() as Promise<DataResponse<ReceivingDomain>>;
  }

  async getReceivingDomain(id: string): Promise<DataResponse<ReceivingDomain>> {
    const response = await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(id)}`,
      undefined,
      'Get receiving domain',
      'Run `paubox receiving domains list` to see the domains on this account.',
    );
    return response.json() as Promise<DataResponse<ReceivingDomain>>;
  }

  async deleteReceivingDomain(id: string): Promise<void> {
    await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      'Delete receiving domain',
      'Run `paubox receiving domains list` to see the domains on this account.',
    );
  }

  async listMailboxes(domainId: string): Promise<DataResponse<ReceivingMailbox[]>> {
    const response = await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes`,
      undefined,
      'List mailboxes',
      'Run `paubox receiving domains list` to check the domain ID.',
    );
    return response.json() as Promise<DataResponse<ReceivingMailbox[]>>;
  }

  async createMailbox(
    domainId: string,
    options: CreateMailboxOptions,
  ): Promise<DataResponse<ReceivingMailbox>> {
    const response = await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes`,
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(options) },
      'Create mailbox',
      'Run `paubox receiving domains list` to check the domain ID.',
    );
    return response.json() as Promise<DataResponse<ReceivingMailbox>>;
  }

  async getMailbox(domainId: string, mailboxId: string): Promise<DataResponse<ReceivingMailbox>> {
    const response = await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
      undefined,
      'Get mailbox',
      'Run `paubox receiving mailboxes list <domainId>` to see the mailboxes on this domain.',
    );
    return response.json() as Promise<DataResponse<ReceivingMailbox>>;
  }

  async deleteMailbox(domainId: string, mailboxId: string): Promise<void> {
    await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
      { method: 'DELETE' },
      'Delete mailbox',
      'Run `paubox receiving mailboxes list <domainId>` to see the mailboxes on this domain.',
    );
  }

  async listReceivedEmails(params?: ListReceivedEmailsParams): Promise<ReceivedEmailList> {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.after !== undefined) query.set('after', params.after);
    if (params?.before !== undefined) query.set('before', params.before);
    const qs = query.toString();
    const response = await this.receivingRequest(
      `/receiving${qs ? `?${qs}` : ''}`,
      undefined,
      'List received emails',
    );
    return response.json() as Promise<ReceivedEmailList>;
  }

  async getReceivedEmail(emailId: string): Promise<DataResponse<ReceivedEmail>> {
    const response = await this.receivingRequest(
      `/receiving/${encodeURIComponent(emailId)}`,
      undefined,
      'Get received email',
      STALE_EMAIL_ID_HINT,
    );
    return response.json() as Promise<DataResponse<ReceivedEmail>>;
  }

  async downloadAttachment(emailId: string, attachmentId: string): Promise<DownloadedAttachment> {
    const response = await this.receivingRequest(
      `/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
      undefined,
      'Download attachment',
      STALE_ATTACHMENT_ID_HINT,
    );
    return {
      data: Buffer.from(await response.arrayBuffer()),
      filename: contentDispositionFilename(response.headers.get('content-disposition')),
      contentType: response.headers.get('content-type'),
    };
  }

  /**
   * Probe whether the stored Email API key authenticates.
   *
   * GET /messages is not a routed method, so it 404s for any key, valid or not.
   * message_receipt does authenticate, so it is the only cheap 401 probe we
   * have. Deliberately bypasses HttpClient: a 404 here is the success case, and
   * a transport failure must read as "could not check" rather than "invalid".
   */
  async validateCredentials(): Promise<boolean> {
    try {
      const response = await this.http.request(
        `${this.baseUrl}/message_receipt?sourceTrackingId=credential-check`,
        {},
        { operation: 'Credential check' },
      );
      return response.status !== 401;
    } catch (err) {
      if (err instanceof AuthError) return false;
      // A 404 is the expected shape of a *successful* probe.
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return true;
      throw err;
    }
  }
}
