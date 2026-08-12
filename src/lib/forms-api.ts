import { ApiError, AuthError, ConfigError } from './errors';
import type {
  CreateFormBody,
  FormGetResponse,
  FormListResponse,
  FormRecord,
  FormStatsResponse,
  FormSubmissionPayload,
  ListFormsParams,
  ListSubmissionsParams,
  SubmissionListResponse,
  UpdateFormBody,
} from '../types';

const FORMS_BASE_URL = 'https://apx.paubox.com/forms';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizePathSegment(value: string, label: string, requireUuid: boolean): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`${label} is required.`);
  }
  if (value === '.' || value === '..') {
    throw new ConfigError(
      `${label} cannot be "." or ".." — path-traversal segments are rejected.`,
    );
  }
  if (requireUuid && !UUID_RE.test(value)) {
    throw new ConfigError(`${label} must be a UUID.`);
  }
  return encodeURIComponent(value);
}

type FetchFn = typeof fetch;

export class FormsApiClient {
  private readonly fetchFn: FetchFn;
  private readonly apiKey: string | null;

  constructor(fetchFn?: FetchFn, apiKey?: string | null) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
    this.apiKey = apiKey ?? null;
  }

  async getForm(formId: string): Promise<FormGetResponse> {
    const safeFormId = sanitizePathSegment(formId, 'formId', false);
    const url = `${FORMS_BASE_URL}/public/form_data/${safeFormId}`;
    const response = await this.fetchFn(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw new ApiError('Form not found.', 404, 'Check the form ID and try again.');
      }
      const body = await response.text();
      throw new ApiError(`Get form failed (${response.status}): ${body}`, response.status);
    }

    return response.json() as Promise<FormGetResponse>;
  }

  async submitForm(formId: string, payload: FormSubmissionPayload): Promise<void> {
    const safeFormId = sanitizePathSegment(formId, 'formId', false);
    const url = `${FORMS_BASE_URL}/api/forms/${safeFormId}/submissions`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status === 201) {
      return;
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new ApiError('Form not found.', 404, 'Check the form ID and try again.');
      }
      if (response.status === 413) {
        throw new ApiError(
          'Payload too large (413).',
          413,
          'Reduce the number or size of --attach files. Maximum total request size is 250 MB.',
        );
      }
      const body = await response.text();
      if (response.status === 422) {
        throw new ApiError(
          `Submission validation failed: ${body}`,
          422,
          'Check your field names and values match the form definition.',
        );
      }
      throw new ApiError(`Submit failed (${response.status}): ${body}`, response.status);
    }
  }

  async listForms(params: ListFormsParams): Promise<FormListResponse> {
    const query = new URLSearchParams();
    if (params.customerId !== undefined) query.set('customer_id', String(params.customerId));
    if (params.formId !== undefined) query.set('form_id', params.formId);
    if (params.search !== undefined) query.set('search', params.search);
    if (params.archived !== undefined) query.set('archived', String(params.archived));
    if (params.active !== undefined) query.set('active', String(params.active));
    if (params.orderBy !== undefined) query.set('order_by', params.orderBy);
    if (params.order !== undefined) query.set('order', params.order);
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.items !== undefined) query.set('items', String(params.items));

    const qs = query.toString();
    const url = `${FORMS_BASE_URL}/api/forms${qs ? `?${qs}` : ''}`;
    const response = await this.fetchFn(url, { headers: this.authHeaders() });

    if (!response.ok) {
      await this.handleError(response);
    }
    return response.json() as Promise<FormListResponse>;
  }

  async getFormStats(customerId?: number): Promise<FormStatsResponse> {
    const query = new URLSearchParams();
    if (customerId !== undefined) query.set('customer_id', String(customerId));
    const qs = query.toString();
    const url = `${FORMS_BASE_URL}/api/forms/stats${qs ? `?${qs}` : ''}`;
    const response = await this.fetchFn(url, { headers: this.authHeaders() });

    if (!response.ok) {
      await this.handleError(response);
    }
    return response.json() as Promise<FormStatsResponse>;
  }

  async getFormAdmin(formId: string): Promise<FormRecord> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const url = `${FORMS_BASE_URL}/api/forms/${safeFormId}`;
    const response = await this.fetchFn(url, { headers: this.authHeaders() });

    if (!response.ok) {
      await this.handleError(response);
    }
    const body = (await response.json()) as { data: FormRecord };
    return body.data;
  }

  async createForm(body: CreateFormBody): Promise<{ id: string }> {
    const url = `${FORMS_BASE_URL}/api/forms`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
    return response.json() as Promise<{ id: string }>;
  }

  async updateForm(formId: string, body: UpdateFormBody): Promise<void> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const url = `${FORMS_BASE_URL}/api/forms/${safeFormId}`;
    const response = await this.fetchFn(url, {
      method: 'PUT',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
  }

  async archiveForm(formId: string): Promise<void> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const url = `${FORMS_BASE_URL}/api/forms/${safeFormId}/archive`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
  }

  async unarchiveForm(formId: string): Promise<void> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const url = `${FORMS_BASE_URL}/api/forms/${safeFormId}/unarchive`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
  }

  async copyForm(formId: string, title: string): Promise<FormRecord> {
    const url = `${FORMS_BASE_URL}/api/forms/copy`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ form_id: formId, title }),
    });

    if (!response.ok) {
      await this.handleError(response);
    }
    return response.json() as Promise<FormRecord>;
  }

  async listSubmissions(
    formId: string,
    params: ListSubmissionsParams,
  ): Promise<SubmissionListResponse> {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.items !== undefined) query.set('items', String(params.items));
    if (params.orderBy !== undefined) query.set('order_by', params.orderBy);
    if (params.order !== undefined) query.set('order', params.order);
    if (params.submissionId !== undefined) query.set('submission_id', params.submissionId);

    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const qs = query.toString();
    const url = `${FORMS_BASE_URL}/api/forms/${safeFormId}/submissions${
      qs ? `?${qs}` : ''
    }`;
    const response = await this.fetchFn(url, { headers: this.authHeaders() });

    if (!response.ok) {
      await this.handleError(response);
    }
    return response.json() as Promise<SubmissionListResponse>;
  }

  async exportSubmissionsCsv(formId: string, submissionId?: string): Promise<Buffer> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const base = `${FORMS_BASE_URL}/api/forms/${safeFormId}/submissions/submission-csv`;
    const url =
      submissionId !== undefined
        ? `${base}/${sanitizePathSegment(submissionId, 'submissionId', true)}`
        : base;
    const response = await this.fetchFn(url, { headers: this.authHeaders() });

    if (response.status !== 200) {
      await this.handleError(response);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async exportSubmissionPdf(formId: string, submissionId: string): Promise<Buffer> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const safeSubmissionId = sanitizePathSegment(submissionId, 'submissionId', true);
    const url = `${FORMS_BASE_URL}/api/forms/${safeFormId}/submissions/${safeSubmissionId}/submission-pdf`;
    const response = await this.fetchFn(url, { headers: this.authHeaders() });

    if (response.status !== 200) {
      await this.handleError(response);
    }
    return Buffer.from(await response.arrayBuffer());
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

  private async handleError(response: Response): Promise<never> {
    if (response.status === 401) {
      throw new AuthError(
        'Forms API key is invalid or lacks the "forms" scope.',
        'Run `paubox auth set-forms-key` with a scoped API key that has the "forms" scope.',
      );
    }
    if (response.status === 403) {
      const body = await response.text();
      throw new ApiError(
        `Forbidden (403): ${body}`,
        403,
        'Check --customer-id matches your account, and that your plan includes Forms access.',
      );
    }
    if (response.status === 404) {
      throw new ApiError('Form or submission not found.', 404, 'Check the ID and try again.');
    }
    const body = await response.text();
    throw new ApiError(`Request failed (${response.status}): ${body}`, response.status);
  }
}
