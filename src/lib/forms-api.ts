import { ApiError, AuthError, ConfigError } from './errors';

/**
 * Exports must be a real 200 with a body. Any other 2xx (e.g. 204) would
 * otherwise be written to disk as an empty file with no error.
 */
function requireOk200(response: Response, operation: string): void {
  if (response.status !== 200) {
    throw new ApiError(
      `${operation} failed: expected a file but the server answered ${response.status} with no export.`,
      response.status,
      'Check that the form has submissions, then retry.',
    );
  }
}
import { HttpClient } from './http';
import type { FetchFn } from './http';
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

export const DEFAULT_FORMS_BASE_URL = 'https://apx.paubox.com/forms';

// The Forms API key is sent to whatever host this resolves to, so the override is
// deliberately limited to http(s) origins. Anyone who can set the environment can
// already read the stored credentials, so this is a guard against typos and
// unsupported schemes rather than a trust boundary.
export function resolveFormsBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PAUBOX_FORMS_URL?.trim();
  if (!override) {
    return DEFAULT_FORMS_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new ConfigError(
      `PAUBOX_FORMS_URL is not a valid URL: ${override}`,
      `Use a full base URL including the scheme, e.g. ${DEFAULT_FORMS_BASE_URL}.`,
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(
      `PAUBOX_FORMS_URL must use http or https, got "${parsed.protocol}".`,
      `Use a full base URL including the scheme, e.g. ${DEFAULT_FORMS_BASE_URL}.`,
    );
  }

  return override.replace(/\/+$/, '');
}

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

const FORM_NOT_FOUND_HINT =
  'Check the form ID. Run `paubox forms list` to see the forms on this account.';

export class FormsApiClient {
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly http: HttpClient;

  constructor(fetchFn?: FetchFn, apiKey?: string | null, baseUrl?: string) {
    this.apiKey = apiKey ?? null;
    this.baseUrl = baseUrl ?? resolveFormsBaseUrl();
    this.http = new HttpClient({
      service: 'forms',
      fetchFn,
      authHeaders: () => this.authHeaders(),
    });
  }

  async getForm(formId: string): Promise<FormGetResponse> {
    const safeFormId = sanitizePathSegment(formId, 'formId', false);
    const response = await this.http.request(
      `${this.baseUrl}/public/form_data/${safeFormId}`,
      {},
      { operation: 'Get form', anonymous: true, hints: { 404: FORM_NOT_FOUND_HINT } },
    );
    return response.json() as Promise<FormGetResponse>;
  }

  async submitForm(formId: string, payload: FormSubmissionPayload): Promise<void> {
    const safeFormId = sanitizePathSegment(formId, 'formId', false);
    await this.http.request(
      `${this.baseUrl}/api/forms/${safeFormId}/submissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      {
        operation: 'Submit form',
        anonymous: true,
        hints: {
          404: FORM_NOT_FOUND_HINT,
          422: 'Check that your field names and values match the form definition. ' +
            'Run `paubox forms get <formId>` to see the fields this form expects.',
        },
      },
    );
  }

  private formsRequest(
    url: string,
    init: RequestInit | undefined,
    operation: string,
    hints?: Partial<Record<number, string>>,
  ): Promise<Response> {
    return this.http.request(url, init ?? {}, {
      operation,
      hints: {
        403: 'Check that --customer-id matches your account and that your plan includes Forms.',
        404: FORM_NOT_FOUND_HINT,
        ...(hints ?? {}),
      },
    });
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
    const url = `${this.baseUrl}/api/forms${qs ? `?${qs}` : ''}`;
    const response = await this.formsRequest(url, undefined, 'List forms');
    return response.json() as Promise<FormListResponse>;
  }

  async getFormStats(customerId?: number): Promise<FormStatsResponse> {
    const query = new URLSearchParams();
    if (customerId !== undefined) query.set('customer_id', String(customerId));
    const qs = query.toString();
    const url = `${this.baseUrl}/api/forms/stats${qs ? `?${qs}` : ''}`;
    const response = await this.formsRequest(url, undefined, 'Get form stats');
    return response.json() as Promise<FormStatsResponse>;
  }

  async getFormAdmin(formId: string): Promise<FormRecord> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const url = `${this.baseUrl}/api/forms/${safeFormId}`;
    const response = await this.formsRequest(url, undefined, 'Get form');
    const body = (await response.json()) as { data: FormRecord };
    return body.data;
  }

  async createForm(body: CreateFormBody): Promise<{ id: string }> {
    const url = `${this.baseUrl}/api/forms`;
    const response = await this.formsRequest(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Create form',
    );
    return response.json() as Promise<{ id: string }>;
  }

  async updateForm(formId: string, body: UpdateFormBody): Promise<void> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const url = `${this.baseUrl}/api/forms/${safeFormId}`;
    await this.formsRequest(
      url,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Update form',
    );
  }

  async archiveForm(formId: string): Promise<void> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const url = `${this.baseUrl}/api/forms/${safeFormId}/archive`;
    await this.formsRequest(url, { method: 'POST' }, 'Archive form');
  }

  async unarchiveForm(formId: string): Promise<void> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const url = `${this.baseUrl}/api/forms/${safeFormId}/unarchive`;
    await this.formsRequest(url, { method: 'POST' }, 'Unarchive form');
  }

  async copyForm(formId: string, title: string): Promise<FormRecord> {
    const url = `${this.baseUrl}/api/forms/copy`;
    const response = await this.formsRequest(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: formId, title }),
      },
      'Copy form',
    );
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
    const url = `${this.baseUrl}/api/forms/${safeFormId}/submissions${
      qs ? `?${qs}` : ''
    }`;
    const response = await this.formsRequest(url, undefined, 'List submissions');
    return response.json() as Promise<SubmissionListResponse>;
  }

  async exportSubmissionsCsv(formId: string, submissionId?: string): Promise<Buffer> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const base = `${this.baseUrl}/api/forms/${safeFormId}/submissions/submission-csv`;
    const url =
      submissionId !== undefined
        ? `${base}/${sanitizePathSegment(submissionId, 'submissionId', true)}`
        : base;
    const response = await this.formsRequest(url, undefined, 'Export submissions CSV');
    requireOk200(response, 'Export submissions CSV');
    return Buffer.from(await response.arrayBuffer());
  }

  async exportSubmissionPdf(formId: string, submissionId: string): Promise<Buffer> {
    const safeFormId = sanitizePathSegment(formId, 'formId', true);
    const safeSubmissionId = sanitizePathSegment(submissionId, 'submissionId', true);
    const url = `${this.baseUrl}/api/forms/${safeFormId}/submissions/${safeSubmissionId}/submission-pdf`;
    const response = await this.formsRequest(url, undefined, 'Export submission PDF');
    requireOk200(response, 'Export submission PDF');
    return Buffer.from(await response.arrayBuffer());
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw AuthError.missing('forms');
    }
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}
