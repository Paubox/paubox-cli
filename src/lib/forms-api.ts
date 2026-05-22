import { createVerboseFetch, type DebugOptions } from './debug';
import { ApiError } from './errors';
import type { FormGetResponse, FormSubmissionPayload } from '../types';

const FORMS_BASE_URL = 'https://apx.paubox.com/forms';

type FetchFn = typeof fetch;

export class FormsApiClient {
  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn, debug?: DebugOptions) {
    const baseFetch = fetchFn ?? globalThis.fetch;
    this.fetchFn = debug ? createVerboseFetch(baseFetch, debug) : baseFetch;
  }

  async getForm(formId: string): Promise<FormGetResponse> {
    const url = `${FORMS_BASE_URL}/public/form_data/${encodeURIComponent(formId)}`;
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
    const url = `${FORMS_BASE_URL}/api/forms/${encodeURIComponent(formId)}/submissions`;
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
}
