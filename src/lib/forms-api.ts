import { ApiError } from './errors';
import { printVerboseRequest, printVerboseResponse } from './output';
import type { FormGetResponse, FormSubmissionPayload } from '../types';

const FORMS_BASE_URL = 'https://apx.paubox.com/forms';

type FetchFn = typeof fetch;

export class FormsApiClient {
  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  async getForm(formId: string): Promise<FormGetResponse> {
    const url = `${FORMS_BASE_URL}/public/form_data/${encodeURIComponent(formId)}`;

    printVerboseRequest('GET', url, {});

    const response = await this.fetchFn(url);
    const responseBody = await response.text();
    printVerboseResponse(response.status, response.statusText, responseBody);

    if (!response.ok) {
      if (response.status === 404) {
        throw new ApiError('Form not found.', 404, 'Check the form ID and try again.');
      }
      throw new ApiError(`Get form failed (${response.status}): ${responseBody}`, response.status);
    }

    return JSON.parse(responseBody) as FormGetResponse;
  }

  async submitForm(formId: string, payload: FormSubmissionPayload): Promise<void> {
    const url = `${FORMS_BASE_URL}/api/forms/${encodeURIComponent(formId)}/submissions`;
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify(payload);

    printVerboseRequest('POST', url, headers, body);

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers,
      body,
    });

    const responseBody = response.status === 201 ? '' : await response.text();
    printVerboseResponse(response.status, response.statusText, responseBody);

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
      if (response.status === 422) {
        throw new ApiError(
          `Submission validation failed: ${responseBody}`,
          422,
          'Check your field names and values match the form definition.',
        );
      }
      throw new ApiError(`Submit failed (${response.status}): ${responseBody}`, response.status);
    }
  }
}
