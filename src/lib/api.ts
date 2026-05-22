import * as fs from 'fs';
import * as path from 'path';
import { ApiError, AuthError } from './errors';
import { printVerboseRequest, printVerboseResponse } from './output';
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

  private redactedAuthHeader(): string {
    const key = this.credentials.apiKey;
    const masked = key.length > 8 ? key.slice(0, 4) + '****' + key.slice(-4) : '****';
    return `Token token=${masked}`;
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResponse> {
    const payload = buildPayload(options);
    const url = `${this.baseUrl}/messages`;
    const headers = {
      Authorization: this.authHeader(),
      'Content-Type': 'application/json',
    };
    const body = JSON.stringify(payload);

    printVerboseRequest('POST', url, { ...headers, Authorization: this.redactedAuthHeader() }, body);

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers,
      body,
    });

    const responseBody = await response.text();
    printVerboseResponse(response.status, response.statusText, responseBody);

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError(
          'Authentication failed.',
          'Check your API credentials with `paubox auth status` or re-run `paubox auth login`.',
        );
      }
      throw new ApiError(`Send failed (${response.status}): ${responseBody}`, response.status);
    }

    return JSON.parse(responseBody) as SendEmailResponse;
  }

  async getMessageStatus(sourceTrackingId: string): Promise<MessageStatusResponse> {
    const url = `${this.baseUrl}/message_receipt?sourceTrackingId=${encodeURIComponent(sourceTrackingId)}`;
    const headers = { Authorization: this.authHeader() };

    printVerboseRequest('GET', url, { Authorization: this.redactedAuthHeader() });

    const response = await this.fetchFn(url, { headers });
    const responseBody = await response.text();
    printVerboseResponse(response.status, response.statusText, responseBody);

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError('Authentication failed.');
      }
      throw new ApiError(`Status check failed (${response.status}): ${responseBody}`, response.status);
    }

    return JSON.parse(responseBody) as MessageStatusResponse;
  }

  async validateCredentials(): Promise<boolean> {
    const url = `${this.baseUrl}/messages`;
    const headers = { Authorization: this.authHeader() };

    printVerboseRequest('GET', url, { Authorization: this.redactedAuthHeader() });

    try {
      const response = await this.fetchFn(url, { headers });
      const responseBody = await response.text();
      printVerboseResponse(response.status, response.statusText, responseBody);
      return response.status !== 401;
    } catch (err) {
      printVerboseResponse(0, 'Network error', err instanceof Error ? err.message : String(err));
      return false;
    }
  }
}
