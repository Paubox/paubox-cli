import * as fs from 'fs';
import type { Command } from 'commander';
import { FormsApiClient } from '../lib/forms-api';
import { resolveAttachments } from '../lib/api';
import { ConfigError } from '../lib/errors';
import { printJson, printSuccess, printInfo } from '../lib/output';
import type { OutputOptions } from '../types';

function parseDataPairs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) {
      throw new ConfigError(
        `Invalid --data value: "${pair}". Expected format: key=value`,
      );
    }
    const key = pair.slice(0, idx);
    if (!key) {
      throw new ConfigError(
        `Invalid --data value: "${pair}". Key must not be empty.`,
      );
    }
    result[key] = pair.slice(idx + 1);
  }
  return result;
}

function readDataFile(filePath: string): Record<string, string> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      `Cannot read --data-file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`--data-file "${filePath}" is not valid JSON.`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError('--data-file must contain a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string') {
      throw new ConfigError(
        `--data-file values must all be strings. Found non-string value for key "${k}".`,
      );
    }
  }

  return obj as Record<string, string>;
}

interface FormsSubmitCmdOptions {
  data: string[];
  dataFile?: string;
  attach: string[];
}

export function registerFormsCommands(program: Command): void {
  const forms = program
    .command('forms')
    .description('Work with Paubox forms');

  forms
    .command('get <formId>')
    .description('Retrieve form metadata')
    .action(async (formId: string) => {
      const opts = program.opts<OutputOptions>();
      const client = new FormsApiClient(undefined, { verbose: opts.verbose });
      const result = await client.getForm(formId);
      if (opts.json) {
        printJson(result);
      } else {
        printInfo(`Form:        ${result.title}`, opts);
        printInfo(`ID:          ${result.id}`, opts);
        printInfo(`Description: ${result.description}`, opts);
        printInfo(`Active:      ${result.active}`, opts);
        printInfo(`Submissions: ${result.submission_count}`, opts);
        printInfo(`Signable:    ${result.signable}`, opts);
        printInfo(`Created:     ${result.created_at}`, opts);
        printInfo(`Updated:     ${result.updated_at}`, opts);
      }
    });

  forms
    .command('submit <formId>')
    .description('Submit data to a form')
    .option(
      '--data <pair...>',
      'Form field as key=value pair (repeatable; --data wins over --data-file on matching keys)',
    )
    .option('--data-file <path>', 'Path to JSON file containing form_data object')
    .option('--attach <file...>', 'File to attach (repeatable; total size must not exceed 250 MB)')
    .action(async (formId: string, cmdOpts: FormsSubmitCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const pairData = parseDataPairs(cmdOpts.data ?? []);
      const fileData = cmdOpts.dataFile ? readDataFile(cmdOpts.dataFile) : {};
      const formData = { ...fileData, ...pairData };

      if (Object.keys(formData).length === 0) {
        throw new ConfigError(
          'No form data provided.',
          'Use --data key=value or --data-file <path>.',
        );
      }

      const attachments = cmdOpts.attach?.length
        ? resolveAttachments(cmdOpts.attach)
        : undefined;

      const client = new FormsApiClient(undefined, { verbose: opts.verbose });
      await client.submitForm(formId, {
        form_data: formData,
        ...(attachments ? { attachments } : {}),
      });

      if (opts.json) {
        printJson({ status: 'ok', formId });
      } else {
        printSuccess('Form submitted successfully.', opts);
      }
    });
}
