import * as fs from 'fs';
import * as path from 'path';
import { ApiError, AuthError } from './errors';
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
  WebhookEndpoint,
  WebhookEndpointResponse,
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
  return filePaths.map((filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new ApiError(`Attachment not found: ${filePath}`);
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

type FetchFn = typeof fetch;

export class PauboxApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(private readonly credentials: PauboxCredentials, fetchFn?: FetchFn) {
    this.baseUrl = 'https://api.paubox.com/v1/email';
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  private authHeader(): string {
    return `Token token=${this.credentials.apiKey}`;
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResponse> {
    const payload = buildPayload(options);
    const response = await this.fetchFn(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError(
          'Authentication failed.',
          'Check your API credentials with `paubox auth status` or re-run `paubox auth login`.',
        );
      }
      const body = await response.text();
      throw new ApiError(`Send failed (${response.status}): ${body}`, response.status);
    }

    return response.json() as Promise<SendEmailResponse>;
  }

  async getMessageStatus(sourceTrackingId: string): Promise<MessageStatusResponse> {
    const url = `${this.baseUrl}/message_receipt?sourceTrackingId=${encodeURIComponent(sourceTrackingId)}`;
    const response = await this.fetchFn(url, {
      headers: { Authorization: this.authHeader() },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError('Authentication failed.');
      }
      const body = await response.text();
      throw new ApiError(`Status check failed (${response.status}): ${body}`, response.status);
    }

    return response.json() as Promise<MessageStatusResponse>;
  }

  async scheduleEmail(options: ScheduleEmailOptions): Promise<ScheduleEmailResponse> {
    const payload = buildPayload(options);
    const response = await this.fetchFn(`${this.baseUrl}/schedule`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          ...payload.data,
          scheduled_at: options.scheduledAt,
        },
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError(
          'Authentication failed.',
          'Check your API credentials with `paubox auth status` or re-run `paubox auth login`.',
        );
      }
      const body = await response.text();
      throw new ApiError(`Schedule failed (${response.status}): ${body}`, response.status);
    }

    return response.json() as Promise<ScheduleEmailResponse>;
  }

  async getScheduledMessage(sourceTrackingId: string): Promise<ScheduledMessageResponse> {
    const response = await this.fetchFn(
      `${this.baseUrl}/schedule/${encodeURIComponent(sourceTrackingId)}`,
      { headers: { Authorization: this.authHeader() } },
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError('Authentication failed.');
      }
      const body = await response.text();
      throw new ApiError(`Get scheduled message failed (${response.status}): ${body}`, response.status);
    }

    return response.json() as Promise<ScheduledMessageResponse>;
  }

  async rescheduleMessage(sourceTrackingId: string, scheduledAt: string): Promise<ScheduledMessageResponse> {
    const response = await this.fetchFn(
      `${this.baseUrl}/schedule/${encodeURIComponent(sourceTrackingId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scheduled_at: scheduledAt }),
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError('Authentication failed.');
      }
      const body = await response.text();
      throw new ApiError(`Reschedule failed (${response.status}): ${body}`, response.status);
    }

    return response.json() as Promise<ScheduledMessageResponse>;
  }

  async cancelScheduledMessage(sourceTrackingId: string): Promise<ScheduledMessageResponse> {
    const response = await this.fetchFn(
      `${this.baseUrl}/schedule/${encodeURIComponent(sourceTrackingId)}/cancel`,
      {
        method: 'POST',
        headers: { Authorization: this.authHeader() },
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError('Authentication failed.');
      }
      const body = await response.text();
      throw new ApiError(`Cancel failed (${response.status}): ${body}`, response.status);
    }

    return response.json() as Promise<ScheduledMessageResponse>;
  }

  private async receivingRequest(
    path: string,
    init?: RequestInit,
    notFoundSuggestion?: string,
  ): Promise<Response> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError(
          'Authentication failed.',
          'Check your API credentials with `paubox auth status` or re-run `paubox auth login`.',
        );
      }
      const body = await response.text();
      throw new ApiError(
        `Request failed (${response.status}): ${body}`,
        response.status,
        response.status === 404 ? notFoundSuggestion : undefined,
      );
    }
    return response;
  }

  async listReceivingDomains(): Promise<ReceivingDomain[]> {
    const response = await this.receivingRequest('/receiving/domains');
    return response.json() as Promise<ReceivingDomain[]>;
  }

  async createReceivingDomain(slug?: string): Promise<ReceivingDomain> {
    const body = slug !== undefined ? JSON.stringify({ slug }) : undefined;
    const response = await this.receivingRequest('/receiving/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body } : {}),
    });
    return response.json() as Promise<ReceivingDomain>;
  }

  async getReceivingDomain(id: string): Promise<ReceivingDomain> {
    const response = await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(id)}`,
    );
    return response.json() as Promise<ReceivingDomain>;
  }

  async deleteReceivingDomain(id: string): Promise<void> {
    await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  async listMailboxes(domainId: string): Promise<ReceivingMailbox[]> {
    const response = await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes`,
    );
    return response.json() as Promise<ReceivingMailbox[]>;
  }

  async createMailbox(
    domainId: string,
    options: CreateMailboxOptions,
  ): Promise<ReceivingMailbox> {
    const response = await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      },
    );
    return response.json() as Promise<ReceivingMailbox>;
  }

  async getMailbox(domainId: string, mailboxId: string): Promise<ReceivingMailbox> {
    const response = await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
    );
    return response.json() as Promise<ReceivingMailbox>;
  }

  async deleteMailbox(domainId: string, mailboxId: string): Promise<void> {
    await this.receivingRequest(
      `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
      { method: 'DELETE' },
    );
  }

  async listReceivedEmails(params?: ListReceivedEmailsParams): Promise<ReceivedEmailList> {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.after !== undefined) query.set('after', params.after);
    if (params?.before !== undefined) query.set('before', params.before);
    const qs = query.toString();
    const response = await this.receivingRequest(`/receiving${qs ? `?${qs}` : ''}`);
    return response.json() as Promise<ReceivedEmailList>;
  }

  async getReceivedEmail(emailId: string): Promise<DataResponse<ReceivedEmail>> {
    const response = await this.receivingRequest(
      `/receiving/${encodeURIComponent(emailId)}`,
      undefined,
      STALE_EMAIL_ID_HINT,
    );
    return response.json() as Promise<DataResponse<ReceivedEmail>>;
  }

  async downloadAttachment(emailId: string, attachmentId: string): Promise<DownloadedAttachment> {
    const response = await this.receivingRequest(
      `/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
      undefined,
      STALE_ATTACHMENT_ID_HINT,
    );
    return {
      data: Buffer.from(await response.arrayBuffer()),
      filename: contentDispositionFilename(response.headers.get('content-disposition')),
      contentType: response.headers.get('content-type'),
    };
  }

  async listWebhookEndpoints(): Promise<WebhookEndpoint[]> {
    const response = await this.receivingRequest('/webhook_endpoints');
    return response.json() as Promise<WebhookEndpoint[]>;
  }

  async createWebhookEndpoint(
    targetUrl: string,
    events: string[],
    signingKey?: string,
    active?: boolean,
  ): Promise<WebhookEndpointResponse> {
    const body: Record<string, unknown> = { target_url: targetUrl, events };
    if (signingKey !== undefined) body.signing_key = signingKey;
    if (active !== undefined) body.active = active;
    const response = await this.receivingRequest('/webhook_endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json() as Promise<WebhookEndpointResponse>;
  }

  async getWebhookEndpoint(id: number): Promise<WebhookEndpointResponse> {
    const response = await this.receivingRequest(
      `/webhook_endpoints/${encodeURIComponent(id)}`,
    );
    return response.json() as Promise<WebhookEndpointResponse>;
  }

  async updateWebhookEndpoint(
    id: number,
    changes: Record<string, unknown>,
  ): Promise<WebhookEndpointResponse> {
    const response = await this.receivingRequest(
      `/webhook_endpoints/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      },
    );
    return response.json() as Promise<WebhookEndpointResponse>;
  }

  async deleteWebhookEndpoint(id: number): Promise<void> {
    await this.receivingRequest(
      `/webhook_endpoints/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  async validateCredentials(): Promise<boolean> {
    try {
      // GET /messages is not a routed method, so it 404s for any key, valid or not.
      // message_receipt does authenticate, so it is the only cheap 401 probe we have.
      const response = await this.fetchFn(
        `${this.baseUrl}/message_receipt?sourceTrackingId=credential-check`,
        { headers: { Authorization: this.authHeader() } },
      );
      return response.status !== 401;
    } catch {
      return false;
    }
  }
}
