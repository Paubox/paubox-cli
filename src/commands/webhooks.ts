import type { Command } from 'commander';
import * as credentials from '../lib/credentials';
import { AuthError, ConfigError } from '../lib/errors';
import { printInfo, printJson, printSuccess, printTable, printWarning } from '../lib/output';
import { WebhooksApiClient } from '../lib/webhooks-api';
import type {
  ListWebhookSubscriptionsParams,
  OutputOptions,
  UpdateWebhookSubscriptionBody,
  WebhookSubscription,
} from '../types';

const STATUSES = ['active', 'disabled'] as const;

function parseIntStrict(value: string, optionName: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new ConfigError(`${optionName} must be an integer. Got "${value}".`);
  }
  return parseInt(value, 10);
}

function parseStatus(value: string): (typeof STATUSES)[number] {
  if (!(STATUSES as readonly string[]).includes(value)) {
    throw new ConfigError(
      `--status must be one of: ${STATUSES.join(', ')}. Got "${value}".`,
    );
  }
  return value as (typeof STATUSES)[number];
}

/**
 * Both stored keys can reach this service now; which events each may subscribe
 * to is decided server-side from the key's scopes. The Forms key is preferred
 * only because it is the narrower of the two — if it is absent, the Email API
 * key is a legitimate credential here and manages the four api_mail_log_
 * events.
 */
async function createClient(): Promise<WebhooksApiClient> {
  const creds = await credentials.loadCredentials();
  const key = creds?.formsApiKey ?? creds?.apiKey;
  if (!key) {
    throw new AuthError(
      'Not authenticated.',
      'Run `paubox auth login` to store an API key.',
    );
  }
  return new WebhooksApiClient(undefined, key);
}

function printSubscription(sub: WebhookSubscription, opts: OutputOptions): void {
  printInfo(`ID:         ${sub.id}`, opts);
  printInfo(`Target URL: ${sub.target_url}`, opts);
  printInfo(`Status:     ${sub.status}`, opts);
  printInfo(`Events:     ${sub.events.join(', ')}`, opts);
  printInfo(`Created:    ${sub.created_at}`, opts);
  printInfo(`Updated:    ${sub.updated_at}`, opts);
}

interface ListCmdOptions {
  page?: string;
  items?: string;
}

interface CreateCmdOptions {
  url: string;
  events: string[];
}

interface UpdateCmdOptions {
  url?: string;
  events?: string[];
  status?: string;
}

/**
 * Builds the webhook subcommands onto `parent`.
 *
 * Registered twice: once as `paubox webhooks`, and once as
 * `paubox forms webhooks` with `deprecated` set, so scripts written against
 * 1.4.0 keep working while the help output advertises only one surface.
 */
export function buildWebhookCommands(
  parent: Command,
  program: Command,
  { deprecated = false }: { deprecated?: boolean } = {},
): void {
  const deprecationNotice = (opts: OutputOptions): void => {
    if (!deprecated) return;
    printWarning(
      '`paubox forms webhooks` is deprecated; use `paubox webhooks`. It manages every event your key is scoped for, not just Forms.',
      opts,
    );
  };

  const webhooks = parent
    .command('webhooks')
    .description(
      deprecated
        ? 'Deprecated alias for `paubox webhooks`'
        : 'Manage webhook subscriptions',
    );

  webhooks
    .command('list')
    .description('List the webhook subscriptions your API key can act on')
    .option('--page <n>', 'Page number (default 1)')
    .option('--items <n>', 'Items per page (default 50, max 200)')
    .action(async (cmdOpts: ListCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      deprecationNotice(opts);

      const params: ListWebhookSubscriptionsParams = {};
      if (cmdOpts.page !== undefined) params.page = parseIntStrict(cmdOpts.page, '--page');
      if (cmdOpts.items !== undefined) params.items = parseIntStrict(cmdOpts.items, '--items');

      const client = await createClient();
      const result = await client.listSubscriptions(params);

      if (opts.json) {
        printJson(result);
        return;
      }

      if (result.data.length === 0) {
        printInfo('No webhook subscriptions found.', opts);
        return;
      }

      printTable(
        result.data.map((sub) => ({
          id: sub.id,
          target_url: sub.target_url,
          status: sub.status,
          events: sub.events.join(', '),
        })),
      );
      printInfo(`${result.page_info.count} subscriptions total.`, opts);
    });

  webhooks
    .command('create')
    .description('Subscribe a URL to one or more events')
    .requiredOption('--url <url>', 'Delivery target; must be an https URL')
    .requiredOption('--events <events...>', 'Events to subscribe to')
    .action(async (cmdOpts: CreateCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      deprecationNotice(opts);

      const client = await createClient();
      const result = await client.createSubscription({
        target_url: cmdOpts.url,
        events: cmdOpts.events,
      });

      if (opts.json) {
        printJson(result);
        return;
      }

      printSuccess(`Subscribed ${result.target_url} to ${result.events.join(', ')}.`, opts);
      printSubscription(result, opts);
      printInfo('', opts);
      printInfo(`Signing secret: ${result.signing_secret}`, opts);
      printInfo('Store it now — it is not shown again.', opts);
    });

  webhooks
    .command('get <subscriptionId>')
    .description('Show a webhook subscription')
    .action(async (subscriptionId: string) => {
      const opts = program.opts<OutputOptions>();
      deprecationNotice(opts);

      const client = await createClient();
      const result = await client.getSubscription(subscriptionId);

      if (opts.json) {
        printJson({ data: result });
      } else {
        printSubscription(result, opts);
      }
    });

  webhooks
    .command('update <subscriptionId>')
    .description('Update a webhook subscription (only provided fields are sent)')
    .option('--url <url>', 'New delivery target; must be an https URL')
    .option('--events <events...>', 'Replace the subscribed events')
    .option('--status <active|disabled>', 'Pause or resume deliveries')
    .action(async (subscriptionId: string, cmdOpts: UpdateCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      deprecationNotice(opts);

      const body: UpdateWebhookSubscriptionBody = {};
      if (cmdOpts.url !== undefined) body.target_url = cmdOpts.url;
      if (cmdOpts.events !== undefined) body.events = cmdOpts.events;
      if (cmdOpts.status !== undefined) body.status = parseStatus(cmdOpts.status);

      if (Object.keys(body).length === 0) {
        throw new ConfigError(
          'No update options provided.',
          'Pass at least one of --url, --events, --status.',
        );
      }

      const client = await createClient();
      const result = await client.updateSubscription(subscriptionId, body);

      if (opts.json) {
        printJson({ data: result });
      } else {
        printSuccess(`Webhook subscription ${subscriptionId} updated.`, opts);
        printSubscription(result, opts);
      }
    });

  webhooks
    .command('delete <subscriptionId>')
    .description('Delete a webhook subscription')
    .action(async (subscriptionId: string) => {
      const opts = program.opts<OutputOptions>();
      deprecationNotice(opts);

      const client = await createClient();
      await client.deleteSubscription(subscriptionId);

      if (opts.json) {
        printJson({ status: 'ok', subscriptionId });
      } else {
        printSuccess(`Webhook subscription ${subscriptionId} deleted.`, opts);
      }
    });
}

export function registerWebhookCommands(program: Command): void {
  buildWebhookCommands(program, program);
}
