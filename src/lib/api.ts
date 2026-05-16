import * as fs from 'fs';
import * as path from 'path';
import { ApiError, AuthError } from './errors';
import type {
  AttachmentOption,
  MessageStatusResponse,
  PauboxCredentials,
  PauboxMessagePayload,
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
    this.baseUrl = `https://api.paubox.net/v1/${credentials.apiUsername}`;
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

  async validateCredentials(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/messages`, {
        headers: { Authorization: this.authHeader() },
      });
      return response.status !== 401;
    } catch {
      return false;
    }
  }
}
