import * as fs from 'fs';
import type { Command } from 'commander';
import { FormsApiClient } from '../lib/forms-api';
import * as credentials from '../lib/credentials';
import { ConfigError } from '../lib/errors';
import { printJson, printSuccess, printInfo } from '../lib/output';
import type {
  CreateFormBody,
  ListFormsParams,
  ListSubmissionsParams,
  OutputOptions,
  UpdateFormBody,
} from '../types';

const FORM_ORDER_COLUMNS = ['title', 'updated_at', 'submission_count', 'created_at'] as const;
const SUBMISSION_ORDER_COLUMNS = ['created_at', 'submitter_email'] as const;
const ORDER_DIRECTIONS = ['asc', 'desc'] as const;

function parseIntStrict(value: string, optionName: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new ConfigError(`${optionName} must be an integer. Got "${value}".`);
  }
  return parseInt(value, 10);
}

function parseBoolStrict(value: string, optionName: string): boolean {
  if (value !== 'true' && value !== 'false') {
    throw new ConfigError(`${optionName} must be "true" or "false". Got "${value}".`);
  }
  return value === 'true';
}

function parseChoice<T extends string>(
  value: string,
  optionName: string,
  allowed: readonly T[],
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ConfigError(
      `${optionName} must be one of: ${allowed.join(', ')}. Got "${value}".`,
    );
  }
  return value as T;
}

function readFileOrThrow(filePath: string, optionName: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      `Cannot read ${optionName} "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function readJsonFile(filePath: string, optionName: string): unknown {
  const raw = readFileOrThrow(filePath, optionName);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ConfigError(`${optionName} "${filePath}" is not valid JSON.`);
  }
}

async function createClient(): Promise<FormsApiClient> {
  const creds = await credentials.loadCredentials();
  return new FormsApiClient(undefined, creds?.formsApiKey);
}

interface ListCmdOptions {
  customerId: string;
  page?: string;
  items?: string;
  search?: string;
  formId?: string;
  active?: string;
  archived?: string;
  orderBy?: string;
  order?: string;
}

interface StatsCmdOptions {
  customerId?: string;
}

interface SubmissionsCmdOptions {
  page?: string;
  items?: string;
  orderBy?: string;
  order?: string;
  submissionId?: string;
}

interface ExportCmdOptions {
  output?: string;
}

interface CopyCmdOptions {
  title: string;
}

interface CreateCmdOptions {
  title: string;
  customerId: string;
  formJsonFile: string;
  description?: string;
  recipient?: string;
  active: boolean;
  signable?: boolean;
  signatureConfirmationLabel?: string;
  subscriptionListId?: string;
  type?: string;
  version: string;
  formHtmlFile?: string;
  formCssFile?: string;
}

interface UpdateCmdOptions {
  title?: string;
  description?: string;
  recipient?: string;
  active?: string;
  vanityUrl?: string;
  subscriptionListId?: string;
  formJsonFile?: string;
}

export function registerFormsAdminCommands(forms: Command, program: Command): void {
  forms
    .command('list')
    .description('List forms (requires a Forms API key)')
    .requiredOption('--customer-id <id>', 'Customer ID to list forms for')
    .option('--page <n>', 'Page number (default 1)')
    .option('--items <n>', 'Items per page (default 50, max 100)')
    .option('--search <text>', 'Search text (matches title/description)')
    .option('--form-id <id>', 'Filter to a single form ID')
    .option('--active <true|false>', 'Filter by active state')
    .option('--archived <true|false>', 'Filter by archived state')
    .option('--order-by <col>', `Sort column: ${FORM_ORDER_COLUMNS.join(', ')}`)
    .option('--order <asc|desc>', 'Sort direction')
    .action(async (cmdOpts: ListCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: ListFormsParams = {
        customerId: parseIntStrict(cmdOpts.customerId, '--customer-id'),
      };
      if (cmdOpts.page !== undefined) params.page = parseIntStrict(cmdOpts.page, '--page');
      if (cmdOpts.items !== undefined) params.items = parseIntStrict(cmdOpts.items, '--items');
      if (cmdOpts.search !== undefined) params.search = cmdOpts.search;
      if (cmdOpts.formId !== undefined) params.formId = cmdOpts.formId;
      if (cmdOpts.active !== undefined) {
        params.active = parseBoolStrict(cmdOpts.active, '--active');
      }
      if (cmdOpts.archived !== undefined) {
        params.archived = parseBoolStrict(cmdOpts.archived, '--archived');
      }
      if (cmdOpts.orderBy !== undefined) {
        params.orderBy = parseChoice(cmdOpts.orderBy, '--order-by', FORM_ORDER_COLUMNS);
      }
      if (cmdOpts.order !== undefined) {
        params.order = parseChoice(cmdOpts.order, '--order', ORDER_DIRECTIONS);
      }

      const client = await createClient();
      const result = await client.listForms(params);

      if (opts.json) {
        printJson(result);
        return;
      }

      for (const form of result.results) {
        printInfo(
          `${form.id}  ${form.title}  active=${form.active} archived=${form.archived ?? false} submissions=${form.submission_count ?? 0}`,
          opts,
        );
      }
      const { page, pages, count } = result.page_info;
      printInfo(`Page ${page} of ${pages} (${count} forms total)`, opts);
    });

  forms
    .command('stats')
    .description('Show form statistics (requires a Forms API key)')
    .option('--customer-id <id>', "Customer ID (defaults to the API key's customer)")
    .action(async (cmdOpts: StatsCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const customerId =
        cmdOpts.customerId !== undefined
          ? parseIntStrict(cmdOpts.customerId, '--customer-id')
          : undefined;

      const client = await createClient();
      const result = await client.getFormStats(customerId);

      if (opts.json) {
        printJson(result);
        return;
      }

      printInfo(`Active forms:            ${result.active_form_count}`, opts);
      printInfo(`Total submissions:       ${result.total_submission_count}`, opts);
      printInfo(`Submissions (last 7d):   ${result.submissions_last_7_days}`, opts);
    });

  forms
    .command('submissions <formId>')
    .description('List submissions for a form (requires a Forms API key)')
    .option('--page <n>', 'Page number (default 1)')
    .option('--items <n>', 'Items per page (default 50, max 100)')
    .option('--order-by <col>', `Sort column: ${SUBMISSION_ORDER_COLUMNS.join(', ')}`)
    .option('--order <asc|desc>', 'Sort direction')
    .option('--submission-id <id>', 'Filter to a single submission ID')
    .action(async (formId: string, cmdOpts: SubmissionsCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: ListSubmissionsParams = {};
      if (cmdOpts.page !== undefined) params.page = parseIntStrict(cmdOpts.page, '--page');
      if (cmdOpts.items !== undefined) params.items = parseIntStrict(cmdOpts.items, '--items');
      if (cmdOpts.orderBy !== undefined) {
        params.orderBy = parseChoice(cmdOpts.orderBy, '--order-by', SUBMISSION_ORDER_COLUMNS);
      }
      if (cmdOpts.order !== undefined) {
        params.order = parseChoice(cmdOpts.order, '--order', ORDER_DIRECTIONS);
      }
      if (cmdOpts.submissionId !== undefined) params.submissionId = cmdOpts.submissionId;

      const client = await createClient();
      const result = await client.listSubmissions(formId, params);

      if (opts.json) {
        printJson(result);
        return;
      }

      for (const submission of result.data) {
        printInfo(
          `${submission.id}  ${submission.created_at}  ${submission.submitter_email ?? '-'}`,
          opts,
        );
      }
      printInfo(`Page ${result.page} (${result.total} submissions total)`, opts);
    });

  forms
    .command('export-csv <formId> [submissionId]')
    .description('Export submissions as CSV (requires a Forms API key)')
    .option('--output <path>', 'Output file path')
    .action(async (formId: string, submissionId: string | undefined, cmdOpts: ExportCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const outputPath =
        cmdOpts.output ??
        (submissionId !== undefined
          ? `submission-${submissionId}.csv`
          : `form-${formId}-submissions.csv`);

      const client = await createClient();
      const csv = await client.exportSubmissionsCsv(formId, submissionId);
      fs.writeFileSync(outputPath, csv);

      if (opts.json) {
        printJson({ status: 'ok', formId, output: outputPath });
      } else {
        printSuccess(`CSV written to ${outputPath}`, opts);
      }
    });

  forms
    .command('export-pdf <formId> <submissionId>')
    .description('Export a submission as PDF (requires a Forms API key)')
    .option('--output <path>', 'Output file path')
    .action(async (formId: string, submissionId: string, cmdOpts: ExportCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const outputPath = cmdOpts.output ?? `submission-${submissionId}.pdf`;

      const client = await createClient();
      const pdf = await client.exportSubmissionPdf(formId, submissionId);
      fs.writeFileSync(outputPath, pdf);

      if (opts.json) {
        printJson({ status: 'ok', formId, submissionId, output: outputPath });
      } else {
        printSuccess(`PDF written to ${outputPath}`, opts);
      }
    });

  forms
    .command('archive <formId>')
    .description('Archive a form (requires a Forms API key)')
    .action(async (formId: string) => {
      const opts = program.opts<OutputOptions>();

      const client = await createClient();
      await client.archiveForm(formId);

      if (opts.json) {
        printJson({ status: 'ok', formId });
      } else {
        printSuccess(`Form ${formId} archived.`, opts);
      }
    });

  forms
    .command('unarchive <formId>')
    .description('Unarchive a form (requires a Forms API key)')
    .action(async (formId: string) => {
      const opts = program.opts<OutputOptions>();

      const client = await createClient();
      await client.unarchiveForm(formId);

      if (opts.json) {
        printJson({ status: 'ok', formId });
      } else {
        printSuccess(`Form ${formId} unarchived.`, opts);
      }
    });

  forms
    .command('copy <formId>')
    .description('Copy a form (requires a Forms API key)')
    .requiredOption('--title <title>', 'Title for the copied form')
    .action(async (formId: string, cmdOpts: CopyCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const client = await createClient();
      const result = await client.copyForm(formId, cmdOpts.title);

      if (opts.json) {
        printJson(result);
        return;
      }

      printSuccess('Form copied.', opts);
      printInfo(`ID:    ${result.id}`, opts);
      printInfo(`Title: ${result.title}`, opts);
    });

  forms
    .command('create')
    .description('Create a form (requires a Forms API key)')
    .requiredOption('--title <t>', 'Form title')
    .requiredOption('--customer-id <id>', 'Customer ID that owns the form')
    .requiredOption('--form-json-file <path>', 'Path to a JSON file with the form definition')
    .option('--description <text>', 'Form description')
    .option('--recipient <email>', 'Recipient email address')
    .option('--active', 'Mark the form active', false)
    .option('--signable', 'Mark the form signable')
    .option('--signature-confirmation-label <label>', 'Signature confirmation label')
    .option('--subscription-list-id <id>', 'Subscription list ID')
    .option('--type <type>', 'Form type')
    .option('--version <n>', 'Form version', '1')
    .option('--form-html-file <path>', 'Path to a file with the form HTML')
    .option('--form-css-file <path>', 'Path to a file with the form CSS')
    .action(async (cmdOpts: CreateCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const body: CreateFormBody = {
        title: cmdOpts.title,
        customer_id: parseIntStrict(cmdOpts.customerId, '--customer-id'),
        form_json: readJsonFile(cmdOpts.formJsonFile, '--form-json-file'),
        version: parseIntStrict(cmdOpts.version, '--version'),
        active: cmdOpts.active,
      };
      if (cmdOpts.description !== undefined) body.description = cmdOpts.description;
      if (cmdOpts.recipient !== undefined) body.recipient = cmdOpts.recipient;
      if (cmdOpts.signable) body.signable = true;
      if (cmdOpts.signatureConfirmationLabel !== undefined) {
        body.signature_confirmation_label = cmdOpts.signatureConfirmationLabel;
      }
      if (cmdOpts.subscriptionListId !== undefined) {
        body.subscription_list_id = cmdOpts.subscriptionListId;
      }
      if (cmdOpts.type !== undefined) body.type = cmdOpts.type;
      if (cmdOpts.formHtmlFile !== undefined) {
        body.form_html = readFileOrThrow(cmdOpts.formHtmlFile, '--form-html-file');
      }
      if (cmdOpts.formCssFile !== undefined) {
        body.form_css = readFileOrThrow(cmdOpts.formCssFile, '--form-css-file');
      }

      const client = await createClient();
      const result = await client.createForm(body);

      if (opts.json) {
        printJson(result);
      } else {
        printSuccess(`Form created: ${result.id}`, opts);
      }
    });

  forms
    .command('update <formId>')
    .description('Update a form (requires a Forms API key; only provided fields are sent)')
    .option('--title <t>', 'New title')
    .option('--description <text>', 'New description')
    .option('--recipient <email>', 'New recipient email address')
    .option('--active <true|false>', 'Set active state')
    .option('--vanity-url <url>', 'New vanity URL')
    .option('--subscription-list-id <id>', 'New subscription list ID')
    .option('--form-json-file <path>', 'Path to a JSON file with the new form definition')
    .action(async (formId: string, cmdOpts: UpdateCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const body: UpdateFormBody = {};
      if (cmdOpts.title !== undefined) body.title = cmdOpts.title;
      if (cmdOpts.description !== undefined) body.description = cmdOpts.description;
      if (cmdOpts.recipient !== undefined) body.recipient = cmdOpts.recipient;
      if (cmdOpts.active !== undefined) {
        body.active = parseBoolStrict(cmdOpts.active, '--active');
      }
      if (cmdOpts.vanityUrl !== undefined) body.vanity_url = cmdOpts.vanityUrl;
      if (cmdOpts.subscriptionListId !== undefined) {
        body.subscription_list_id = cmdOpts.subscriptionListId;
      }
      if (cmdOpts.formJsonFile !== undefined) {
        body.form_json = readJsonFile(cmdOpts.formJsonFile, '--form-json-file');
      }

      if (Object.keys(body).length === 0) {
        throw new ConfigError(
          'No update options provided.',
          'Pass at least one of --title, --description, --recipient, --active, --vanity-url, --subscription-list-id, --form-json-file.',
        );
      }

      const client = await createClient();
      await client.updateForm(formId, body);

      if (opts.json) {
        printJson({ status: 'ok', formId });
      } else {
        printSuccess(`Form ${formId} updated.`, opts);
      }
    });
}
