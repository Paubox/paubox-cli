import * as fs from 'fs';
import type { Command } from 'commander';
import { MarketingApiClient } from '../lib/marketing-api';
import * as credentials from '../lib/credentials';
import { confirmDestructive } from '../lib/confirm';
import { ConfigError } from '../lib/errors';
import { printJson, printInfo, printSuccess, printTable } from '../lib/output';
import {
  MARKETING_ANALYTICS_TYPES,
  type DynamicListWriteBody,
  type ExportDynamicListCsvParams,
  type ExportSubscribersCsvParams,
  type GetCampaignParams,
  type GetSubscriberParams,
  type ListCampaignsParams,
  type ListListsParams,
  type ListMarketingListsParams,
  type ListSubscribersParams,
  type MarketingAnalyticsParams,
  type MarketingAnalyticsType,
  type OutputOptions,
  type SubscribedCountParams,
  type SubscriberCustomFieldInput,
  type SubscriberWriteBody,
  type SubscriberWriteData,
  type SubscriptionChangeBody,
} from '../types';

const ORDER_DIRECTIONS = ['asc', 'desc'] as const;
const SUBSCRIBER_ORDER_COLUMNS = [
  'created_at',
  'updated_at',
  'email',
  'first_name',
  'last_name',
] as const;
const LIST_ORDER_COLUMNS = ['name', 'created_at', 'updated_at', 'subscriber_count'] as const;
const CAMPAIGN_ORDER_COLUMNS = ['created_at', 'updated_at', 'subject'] as const;

function parseIntStrict(value: string, optionName: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new ConfigError(`${optionName} must be an integer. Got "${value}".`);
  }
  return parseInt(value, 10);
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

async function createClient(): Promise<MarketingApiClient> {
  const creds = await credentials.loadCredentials();
  // auth set-forms-key can store an empty apiKey, so treat "" as unset and let
  // the client raise the standard AuthError.
  return new MarketingApiClient(undefined, creds?.apiKey ? creds.apiKey : null);
}

function dash(value: unknown): string {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function parseCustomFields(pairs: string[]): SubscriberCustomFieldInput[] {
  return pairs.map((pair) => {
    const idx = pair.indexOf('=');
    if (idx <= 0) {
      throw new ConfigError(
        `--field must be a key=value pair. Got "${pair}".`,
        'Example: --field "Clinic=North Campus"',
      );
    }
    return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
  });
}

function readJsonString(inline: string | undefined, filePath: string | undefined): string | undefined {
  if (inline !== undefined && filePath !== undefined) {
    throw new ConfigError('Pass either --filters or --filters-file, not both.');
  }

  let raw = inline;
  if (filePath !== undefined) {
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new ConfigError(
        `Cannot read --filters-file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (raw === undefined) return undefined;

  try {
    JSON.parse(raw);
  } catch {
    throw new ConfigError(
      'Filters must be valid JSON.',
      'Example: --filters \'[[{"field":"email","op":"contains","terms":["@example.com"]}]]\'',
    );
  }
  return raw;
}

function buildSubscriberBody(cmdOpts: SubscriberWriteCmdOptions): SubscriberWriteBody {
  const subscriber: SubscriberWriteData = {};
  if (cmdOpts.email !== undefined) subscriber.email = cmdOpts.email;
  if (cmdOpts.firstName !== undefined) subscriber.first_name = cmdOpts.firstName;
  if (cmdOpts.lastName !== undefined) subscriber.last_name = cmdOpts.lastName;
  if (cmdOpts.phone !== undefined) subscriber.phone_number = cmdOpts.phone;
  if (cmdOpts.field !== undefined && cmdOpts.field.length > 0) {
    subscriber.custom_fields = parseCustomFields(cmdOpts.field);
  }

  if (Object.keys(subscriber).length === 0) {
    throw new ConfigError(
      'Nothing to send.',
      'Pass at least one of --email, --first-name, --last-name, --phone, or --field.',
    );
  }

  const body: SubscriberWriteBody = { subscriber };
  if (cmdOpts.subscriptionListId !== undefined) {
    body.subscription_list_id = cmdOpts.subscriptionListId;
  }
  return body;
}

function buildListParams(cmdOpts: ListsCmdOptions & { withStats?: boolean }): ListListsParams {
  const params: ListListsParams = {};
  if (cmdOpts.page !== undefined) params.page = parseIntStrict(cmdOpts.page, '--page');
  if (cmdOpts.items !== undefined) params.items = parseIntStrict(cmdOpts.items, '--items');
  if (cmdOpts.orderBy !== undefined) {
    params.orderBy = parseChoice(cmdOpts.orderBy, '--order-by', LIST_ORDER_COLUMNS);
  }
  if (cmdOpts.order !== undefined) {
    params.order = parseChoice(cmdOpts.order, '--order', ORDER_DIRECTIONS);
  }
  if (cmdOpts.withStats) params.withStats = true;
  return params;
}

function printListRows(
  data: { id: string; type: string; attributes: { name: string; subscriber_count: number } }[],
  opts: OutputOptions,
): void {
  const rows = data.map((rec) => ({
    ID: rec.id,
    TYPE: dash(rec.type),
    NAME: dash(rec.attributes.name),
    SUBSCRIBERS: dash(rec.attributes.subscriber_count),
  }));
  if (rows.length > 0 && !opts.quiet) {
    printTable(rows);
  }
  printInfo(`${rows.length} list(s)`, opts);
}

interface SubscribersListCmdOptions {
  search?: string;
  orderBy?: string;
  order?: string;
  page?: string;
  items?: string;
  subscriptionListId?: string;
  dynamicListId?: string;
}

interface SubscriberGetCmdOptions {
  subscriptionListId?: string;
  dynamicListId?: string;
  withStats?: boolean;
}

interface SubscribersCountCmdOptions {
  subscriptionListId?: string;
}

interface ListsCmdOptions {
  search?: string;
  orderBy?: string;
  order?: string;
  page?: string;
  items?: string;
}

interface CampaignsListCmdOptions {
  search?: string;
  orderBy?: string;
  order?: string;
  page?: string;
  templateType?: string;
}

interface CampaignGetCmdOptions {
  withImages?: boolean;
}

interface SubscriberWriteCmdOptions {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  field?: string[];
  subscriptionListId?: string;
}

interface ExportCsvCmdOptions {
  email: string;
  fromSubscriptionListId?: string;
  search?: string;
  subscriberId?: string[];
  exceptId?: string[];
}

interface ExportDynamicCsvCmdOptions {
  email: string;
  dynamicListId: string;
  orderBy?: string;
  order?: string;
}

interface SubscriptionChangeCmdOptions {
  subscriberId: string[];
  subscriptionListId?: string[];
  yes?: boolean;
}

interface ListWriteCmdOptions {
  name?: string;
  filters?: string;
  filtersFile?: string;
}

interface ListGetCmdOptions {
  withStats?: boolean;
}

interface DeleteCmdOptions {
  yes?: boolean;
}

interface AnalyticsCmdOptions {
  campaignMailingSendId?: string;
  campaignMailingId?: string;
  dripCampaignId?: string;
  emailType?: string;
  htmlId?: string;
  search?: string;
  orderBy?: string;
  order?: string;
  startDate?: string;
  endDate?: string;
  byDate?: boolean;
  dateOffset?: string;
  withStats?: boolean;
}

export function registerMarketingCommands(program: Command): void {
  const marketing = program
    .command('marketing')
    .description('Work with Paubox Marketing (uses your Paubox API key)');

  registerSubscriberCommands(marketing, program);
  registerSubscriptionCommands(marketing, program);
  registerListCommands(marketing, program);
  registerSubscriptionListCommands(marketing, program);
  registerDynamicListCommands(marketing, program);
  registerCampaignCommands(marketing, program);
  registerAnalyticsCommands(marketing);
  registerJobCommands(marketing, program);
}

function registerSubscriberCommands(marketing: Command, program: Command): void {
  const subscribers = marketing
    .command('subscribers')
    .description('Manage marketing subscribers');

  subscribers
    .command('list')
    .description('List subscribers')
    .option('--search <text>', 'Search text (defaults to all subscribers)')
    .option('--subscription-list-id <id>', 'Filter to a subscription list')
    .option('--dynamic-list-id <id>', 'Filter to a dynamic list')
    .option('--page <n>', 'Page number (default 1)')
    .option('--items <n>', 'Items per page (default 50, max 10000)')
    .option('--order-by <col>', `Sort column: ${SUBSCRIBER_ORDER_COLUMNS.join(', ')}`)
    .option('--order <asc|desc>', 'Sort direction')
    .action(async (cmdOpts: SubscribersListCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: ListSubscribersParams = {};
      if (cmdOpts.search !== undefined) params.search = cmdOpts.search;
      if (cmdOpts.subscriptionListId !== undefined) {
        params.subscriptionListId = cmdOpts.subscriptionListId;
      }
      if (cmdOpts.dynamicListId !== undefined) params.dynamicListId = cmdOpts.dynamicListId;
      if (cmdOpts.page !== undefined) params.page = parseIntStrict(cmdOpts.page, '--page');
      if (cmdOpts.items !== undefined) params.items = parseIntStrict(cmdOpts.items, '--items');
      if (cmdOpts.orderBy !== undefined) {
        params.orderBy = parseChoice(cmdOpts.orderBy, '--order-by', SUBSCRIBER_ORDER_COLUMNS);
      }
      if (cmdOpts.order !== undefined) {
        params.order = parseChoice(cmdOpts.order, '--order', ORDER_DIRECTIONS);
      }

      const client = await createClient();
      const result = await client.listSubscribers(params);

      if (opts.json) {
        printJson(result);
        return;
      }

      const rows = (result.data ?? []).map((rec) => ({
        ID: rec.id,
        EMAIL: dash(rec.attributes.email),
        NAME: dash(rec.attributes.full_name),
        CREATED: dash(rec.attributes.created_at),
      }));
      if (rows.length > 0 && !opts.quiet) {
        printTable(rows);
      }
      printInfo(`${result.total_count ?? rows.length} subscriber(s) total`, opts);
    });

  subscribers
    .command('get <subscriberId>')
    .description('Show a single subscriber')
    .option('--subscription-list-id <id>', 'Report unsubscribed state for this subscription list')
    .option('--dynamic-list-id <id>', 'Report unsubscribed state for this dynamic list')
    .option('--with-stats', 'Include delivery statistics')
    .action(async (subscriberId: string, cmdOpts: SubscriberGetCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: GetSubscriberParams = {};
      if (cmdOpts.subscriptionListId !== undefined) {
        params.subscriptionListId = cmdOpts.subscriptionListId;
      }
      if (cmdOpts.dynamicListId !== undefined) params.dynamicListId = cmdOpts.dynamicListId;
      if (cmdOpts.withStats) params.withStats = true;

      const client = await createClient();
      const result = await client.getSubscriber(subscriberId, params);

      if (opts.json) {
        printJson(result);
        return;
      }

      const record = result.data;
      if (!record) {
        // The endpoint serializes a nil subscriber as { data: null } with a 200,
        // so a missing record has to be reported here rather than by handleError.
        throw new ConfigError(
          `Subscriber "${subscriberId}" not found.`,
          'Check the subscriber UUID with `paubox marketing subscribers list`.',
        );
      }

      const attrs = record.attributes;
      printInfo(`ID:         ${record.id}`, opts);
      printInfo(`Email:      ${dash(attrs.email)}`, opts);
      printInfo(`Name:       ${dash(attrs.full_name)}`, opts);
      printInfo(`Phone:      ${dash(attrs.phone_number)}`, opts);
      printInfo(`Created:    ${dash(attrs.created_at)}`, opts);
      printInfo(`Updated:    ${dash(attrs.updated_at)}`, opts);
      if (attrs.unsubscribed !== undefined) {
        printInfo(`Unsubscribed: ${attrs.unsubscribed}`, opts);
      }
      for (const field of attrs.custom_fields ?? []) {
        printInfo(`  ${field.name}: ${dash(field.value)}`, opts);
      }
      for (const list of attrs.subscription_lists ?? []) {
        printInfo(`  list ${list.id} ${list.name} unsubscribed=${list.unsubscribed}`, opts);
      }
      if (attrs.statistics !== undefined) {
        printInfo(`Statistics: ${JSON.stringify(attrs.statistics)}`, opts);
      }
    });

  subscribers
    .command('count')
    .description('Show the subscribed count for a list')
    .option('--subscription-list-id <id>', "Subscription list (defaults to the account's default list)")
    .action(async (cmdOpts: SubscribersCountCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: SubscribedCountParams = {};
      if (cmdOpts.subscriptionListId !== undefined) {
        params.subscriptionListId = cmdOpts.subscriptionListId;
      }

      const client = await createClient();
      const result = await client.getSubscribedCount(params);

      if (opts.json) {
        printJson(result);
        return;
      }
      printInfo(`Subscribed: ${result.data}`, opts);
    });

  const writeFlags = (cmd: Command): Command =>
    cmd
      .option('--email <email>', 'Email address')
      .option('--first-name <name>', 'First name')
      .option('--last-name <name>', 'Last name')
      .option('--phone <number>', 'Phone number (normalized to E.164 by the API)')
      .option('--field <pair...>', 'Custom field as name=value (repeatable)')
      .option('--subscription-list-id <id>', 'Also add to this subscription list');

  writeFlags(
    subscribers
      .command('create')
      .description('Create a subscriber (always added to the default list)'),
  ).action(async (cmdOpts: SubscriberWriteCmdOptions) => {
    const opts = program.opts<OutputOptions>();
    const body = buildSubscriberBody(cmdOpts);

    const client = await createClient();
    const result = await client.createSubscriber(body);

    if (opts.json) {
      printJson(result);
      return;
    }
    printSuccess(`Created subscriber ${result.data?.id ?? ''}`.trim(), opts);
  });

  writeFlags(
    subscribers.command('update <subscriberId>').description('Update an existing subscriber'),
  ).action(async (subscriberId: string, cmdOpts: SubscriberWriteCmdOptions) => {
    const opts = program.opts<OutputOptions>();
    const body = buildSubscriberBody(cmdOpts);

    const client = await createClient();
    const result = await client.updateSubscriber(subscriberId, body);

    if (opts.json) {
      printJson(result);
      return;
    }
    printSuccess(`Updated subscriber ${result.data?.id ?? subscriberId}`, opts);
  });

  subscribers
    .command('export-csv')
    .description('Email a CSV export of subscribers (runs as a background job)')
    .requiredOption('--email <email>', 'Address the export is emailed to')
    .option('--from-subscription-list-id <id>', 'Export from this subscription list')
    .option('--search <text>', 'Restrict the export to matching subscribers')
    .option('--subscriber-id <id...>', 'Export only these subscriber UUIDs')
    .option('--except-id <id...>', 'Exclude these subscriber UUIDs')
    .action(async (cmdOpts: ExportCsvCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: ExportSubscribersCsvParams = { email: cmdOpts.email };
      if (cmdOpts.fromSubscriptionListId !== undefined) {
        params.fromSubscriptionListId = cmdOpts.fromSubscriptionListId;
      }
      if (cmdOpts.search !== undefined) params.search = cmdOpts.search;
      if (cmdOpts.subscriberId !== undefined) params.subscriberIds = cmdOpts.subscriberId;
      if (cmdOpts.exceptId !== undefined) params.exceptIds = cmdOpts.exceptId;

      const client = await createClient();
      const result = await client.exportSubscribersCsv(params);

      if (opts.json) {
        printJson(result);
        return;
      }
      printSuccess(`Export queued — will be emailed to ${result.data.sent_to_email}`, opts);
      printInfo(`Job ID: ${result.data.jid}`, opts);
    });

  subscribers
    .command('export-dynamic-csv')
    .description('Email a CSV export of a dynamic list (runs as a background job)')
    .requiredOption('--email <email>', 'Address the export is emailed to')
    .requiredOption('--dynamic-list-id <id>', 'Dynamic list to export')
    .option('--order-by <col>', `Sort column: ${SUBSCRIBER_ORDER_COLUMNS.join(', ')}`)
    .option('--order <asc|desc>', 'Sort direction')
    .action(async (cmdOpts: ExportDynamicCsvCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: ExportDynamicListCsvParams = {
        email: cmdOpts.email,
        dynamicListId: cmdOpts.dynamicListId,
      };
      if (cmdOpts.orderBy !== undefined) {
        params.orderBy = parseChoice(cmdOpts.orderBy, '--order-by', SUBSCRIBER_ORDER_COLUMNS);
      }
      if (cmdOpts.order !== undefined) {
        params.order = parseChoice(cmdOpts.order, '--order', ORDER_DIRECTIONS);
      }

      const client = await createClient();
      const result = await client.exportDynamicListCsv(params);

      if (opts.json) {
        printJson(result);
        return;
      }
      printSuccess(`Export queued — will be emailed to ${result.data.sent_to_email}`, opts);
      printInfo(`Job ID: ${result.data.jid}`, opts);
    });
}

function registerSubscriptionCommands(marketing: Command, program: Command): void {
  const subscriptions = marketing
    .command('subscriptions')
    .description('Subscribe and unsubscribe subscribers');

  subscriptions
    .command('subscribe')
    .description('Subscribe subscribers to lists, and clear any global opt-out')
    .requiredOption('--subscriber-id <id...>', 'Subscriber UUIDs to subscribe')
    .option('--subscription-list-id <id...>', 'Subscription lists to subscribe them to')
    .action(async (cmdOpts: SubscriptionChangeCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const body: SubscriptionChangeBody = { subscriber_ids: cmdOpts.subscriberId };
      if (cmdOpts.subscriptionListId !== undefined) {
        body.subscription_list_ids = cmdOpts.subscriptionListId;
      }

      const client = await createClient();
      const result = await client.subscribe(body);

      if (opts.json) {
        printJson(result);
        return;
      }
      printSuccess(`Subscribed ${result.data?.length ?? 0} subscriber(s)`, opts);
    });

  subscriptions
    .command('unsubscribe')
    .description('Unsubscribe subscribers from lists, or globally when no list is given')
    .requiredOption('--subscriber-id <id...>', 'Subscriber UUIDs to unsubscribe')
    .option('--subscription-list-id <id...>', 'Limit to these subscription lists')
    .option('-y, --yes', 'Skip the confirmation prompt for a global unsubscribe')
    .action(async (cmdOpts: SubscriptionChangeCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const body: SubscriptionChangeBody = { subscriber_ids: cmdOpts.subscriberId };
      if (cmdOpts.subscriptionListId !== undefined) {
        body.subscription_list_ids = cmdOpts.subscriptionListId;
      }

      // Without a list the API sets opted_out_on, which suppresses the
      // subscriber across every list rather than just one.
      if (body.subscription_list_ids === undefined) {
        await confirmDestructive(
          `Globally unsubscribe ${cmdOpts.subscriberId.length} subscriber(s) from ALL lists?`,
          cmdOpts.yes,
        );
      }

      const client = await createClient();
      const result = await client.unsubscribe(body);

      if (opts.json) {
        printJson(result);
        return;
      }
      const scope = body.subscription_list_ids === undefined ? 'globally' : 'from the given list(s)';
      printSuccess(`Unsubscribed ${result.data?.length ?? 0} subscriber(s) ${scope}`, opts);
    });
}

function registerSubscriptionListCommands(marketing: Command, program: Command): void {
  const lists = marketing
    .command('subscription-lists')
    .description('Manage subscription lists');

  lists
    .command('list')
    .description('List subscription lists')
    .option('--page <n>', 'Page number (enables pagination)')
    .option('--items <n>', 'Items per page (enables pagination, default 10)')
    .option('--order-by <col>', `Sort column: ${LIST_ORDER_COLUMNS.join(', ')}`)
    .option('--order <asc|desc>', 'Sort direction')
    .action(async (cmdOpts: ListsCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      const client = await createClient();
      const result = await client.listSubscriptionLists(buildListParams(cmdOpts));

      if (opts.json) {
        printJson(result);
        return;
      }
      printListRows(result.data ?? [], opts);
    });

  lists
    .command('get <listId>')
    .description('Show a subscription list (pass "default" for the default list)')
    .option('--with-stats', 'Include send statistics')
    .action(async (listId: string, cmdOpts: ListGetCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      const client = await createClient();
      const result = await client.getSubscriptionList(listId, {
        ...(cmdOpts.withStats ? { withStats: true } : {}),
      });

      if (opts.json) {
        printJson(result);
        return;
      }

      const record = result.data;
      if (!record) {
        throw new ConfigError(`Subscription list "${listId}" not found.`);
      }
      printInfo(`ID:          ${record.id}`, opts);
      printInfo(`Name:        ${dash(record.attributes.name)}`, opts);
      printInfo(`Subscribers: ${dash(record.attributes.subscriber_count)}`, opts);
      printInfo(`Default:     ${dash(record.attributes.is_default)}`, opts);
      if (record.attributes.statistics !== undefined) {
        printInfo(`Statistics:  ${JSON.stringify(record.attributes.statistics)}`, opts);
      }
    });

  lists
    .command('create')
    .description('Create a subscription list')
    .requiredOption('--name <name>', 'List name')
    .action(async (cmdOpts: ListWriteCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      const client = await createClient();
      const result = await client.createSubscriptionList(cmdOpts.name as string);

      if (opts.json) {
        printJson(result);
        return;
      }
      printSuccess(`Created subscription list ${result.data?.id ?? ''}`.trim(), opts);
    });

  lists
    .command('update <listId>')
    .description('Rename a subscription list')
    .requiredOption('--name <name>', 'New list name')
    .action(async (listId: string, cmdOpts: ListWriteCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      const client = await createClient();
      const result = await client.updateSubscriptionList(listId, cmdOpts.name as string);

      if (opts.json) {
        printJson(result);
        return;
      }
      printSuccess(`Updated subscription list ${result.data?.id ?? listId}`, opts);
    });

  lists
    .command('delete <listId>')
    .description('Delete a subscription list and detach its subscribers')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (listId: string, cmdOpts: DeleteCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      await confirmDestructive(
        `Delete subscription list ${listId}? Its subscriptions are removed and its drip campaigns are marked completed.`,
        cmdOpts.yes,
      );

      const client = await createClient();
      await client.deleteSubscriptionList(listId);

      if (opts.json) {
        printJson({ status: 'deleted', id: listId });
        return;
      }
      // The API silently no-ops on the default list rather than erroring.
      printSuccess(`Deleted subscription list ${listId} (the default list cannot be deleted)`, opts);
    });
}

function registerDynamicListCommands(marketing: Command, program: Command): void {
  const lists = marketing.command('dynamic-lists').description('Manage dynamic lists');

  lists
    .command('list')
    .description('List dynamic lists')
    .option('--page <n>', 'Page number (enables pagination)')
    .option('--items <n>', 'Items per page (enables pagination, default 10)')
    .option('--order-by <col>', `Sort column: ${LIST_ORDER_COLUMNS.join(', ')}`)
    .option('--order <asc|desc>', 'Sort direction')
    .action(async (cmdOpts: ListsCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      const client = await createClient();
      const result = await client.listDynamicLists(buildListParams(cmdOpts));

      if (opts.json) {
        printJson(result);
        return;
      }
      printListRows(result.data ?? [], opts);
    });

  lists
    .command('get <listId>')
    .description('Show a dynamic list')
    .option('--with-stats', 'Include send statistics')
    .action(async (listId: string, cmdOpts: ListGetCmdOptions) => {
      const opts = program.opts<OutputOptions>();
      const client = await createClient();
      const result = await client.getDynamicList(listId, {
        ...(cmdOpts.withStats ? { withStats: true } : {}),
      });

      if (opts.json) {
        printJson(result);
        return;
      }

      const record = result.data;
      if (!record) {
        throw new ConfigError(`Dynamic list "${listId}" not found.`);
      }
      printInfo(`ID:          ${record.id}`, opts);
      printInfo(`Name:        ${dash(record.attributes.name)}`, opts);
      printInfo(`Subscribers: ${dash(record.attributes.subscriber_count)}`, opts);
      printInfo(`Filters:     ${JSON.stringify(record.attributes.filters ?? null)}`, opts);
    });

  lists
    .command('create')
    .description('Create a dynamic list')
    .requiredOption('--name <name>', 'List name')
    .option('--filters <json>', 'Filter definition as JSON')
    .option('--filters-file <path>', 'Read the filter definition from a JSON file')
    .action(async (cmdOpts: ListWriteCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const body: DynamicListWriteBody = { name: cmdOpts.name };
      const filters = readJsonString(cmdOpts.filters, cmdOpts.filtersFile);
      if (filters !== undefined) body.filters = filters;

      const client = await createClient();
      const result = await client.createDynamicList(body);

      if (opts.json) {
        printJson(result);
        return;
      }
      printSuccess(`Created dynamic list ${result.data?.id ?? ''}`.trim(), opts);
    });

  lists
    .command('update <listId>')
    .description('Update a dynamic list')
    .option('--name <name>', 'New list name')
    .option('--filters <json>', 'New filter definition as JSON')
    .option('--filters-file <path>', 'Read the new filter definition from a JSON file')
    .action(async (listId: string, cmdOpts: ListWriteCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const body: DynamicListWriteBody = {};
      if (cmdOpts.name !== undefined) body.name = cmdOpts.name;
      const filters = readJsonString(cmdOpts.filters, cmdOpts.filtersFile);
      if (filters !== undefined) body.filters = filters;

      if (Object.keys(body).length === 0) {
        throw new ConfigError(
          'Nothing to update.',
          'Pass --name and/or --filters (or --filters-file).',
        );
      }

      const client = await createClient();
      const result = await client.updateDynamicList(listId, body);

      if (opts.json) {
        printJson(result);
        return;
      }
      printSuccess(`Updated dynamic list ${result.data?.id ?? listId}`, opts);
    });

  lists
    .command('delete <listId>')
    .description('Delete a dynamic list and detach its subscriptions')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (listId: string, cmdOpts: DeleteCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      await confirmDestructive(`Delete dynamic list ${listId}?`, cmdOpts.yes);

      const client = await createClient();
      await client.deleteDynamicList(listId);

      if (opts.json) {
        printJson({ status: 'deleted', id: listId });
        return;
      }
      printSuccess(`Deleted dynamic list ${listId}`, opts);
    });
}

function registerListCommands(marketing: Command, program: Command): void {
  const lists = marketing
    .command('lists')
    .description('Browse subscription and dynamic lists together');

  lists
    .command('list')
    .description('List subscription and dynamic lists')
    .option('--search <text>', 'Search list names')
    .option('--page <n>', 'Page number (enables pagination)')
    .option('--items <n>', 'Items per page (enables pagination, default 10)')
    .option('--order-by <col>', `Sort column: ${LIST_ORDER_COLUMNS.join(', ')}`)
    .option('--order <asc|desc>', 'Sort direction')
    .action(async (cmdOpts: ListsCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: ListMarketingListsParams = {};
      if (cmdOpts.search !== undefined) params.search = cmdOpts.search;
      if (cmdOpts.page !== undefined) params.page = parseIntStrict(cmdOpts.page, '--page');
      if (cmdOpts.items !== undefined) params.items = parseIntStrict(cmdOpts.items, '--items');
      if (cmdOpts.orderBy !== undefined) {
        params.orderBy = parseChoice(cmdOpts.orderBy, '--order-by', LIST_ORDER_COLUMNS);
      }
      if (cmdOpts.order !== undefined) {
        params.order = parseChoice(cmdOpts.order, '--order', ORDER_DIRECTIONS);
      }

      const client = await createClient();
      const result = await client.listLists(params);

      if (opts.json) {
        printJson(result);
        return;
      }

      const rows = (result.data ?? []).map((rec) => ({
        ID: rec.id,
        TYPE: dash(rec.type),
        NAME: dash(rec.attributes.name),
        SUBSCRIBERS: dash(rec.attributes.subscriber_count),
      }));
      if (rows.length > 0 && !opts.quiet) {
        printTable(rows);
      }
      const info = result.page_info;
      if (info?.page !== undefined) {
        printInfo(`Page ${info.page} of ${info.pages} (${info.count} lists total)`, opts);
      } else {
        printInfo(`${rows.length} list(s)`, opts);
      }
    });
}

function registerCampaignCommands(marketing: Command, program: Command): void {
  const campaigns = marketing
    .command('campaigns')
    .description('Browse campaign mailings');

  campaigns
    .command('list')
    .description('List campaign mailings')
    .option('--search <text>', 'Search campaign subjects')
    .option('--page <n>', 'Page number (default 1)')
    .option('--template-type <type>', 'Filter by template type')
    .option('--order-by <col>', `Sort column: ${CAMPAIGN_ORDER_COLUMNS.join(', ')}`)
    .option('--order <asc|desc>', 'Sort direction')
    .action(async (cmdOpts: CampaignsListCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: ListCampaignsParams = {};
      if (cmdOpts.search !== undefined) params.search = cmdOpts.search;
      if (cmdOpts.page !== undefined) params.page = parseIntStrict(cmdOpts.page, '--page');
      if (cmdOpts.templateType !== undefined) params.templateType = cmdOpts.templateType;
      if (cmdOpts.orderBy !== undefined) {
        params.orderBy = parseChoice(cmdOpts.orderBy, '--order-by', CAMPAIGN_ORDER_COLUMNS);
      }
      if (cmdOpts.order !== undefined) {
        params.order = parseChoice(cmdOpts.order, '--order', ORDER_DIRECTIONS);
      }

      const client = await createClient();
      const result = await client.listCampaigns(params);

      if (opts.json) {
        printJson(result);
        return;
      }

      const rows = (result.data ?? []).map((rec) => ({
        ID: rec.id,
        SUBJECT: dash(rec.attributes.subject ?? rec.attributes.default_subject),
        SENT: dash(rec.attributes.sent_count),
        DELIVERED: dash(rec.attributes.delivered_count),
        VIEWED: dash(rec.attributes.viewed_count),
        CLICKED: dash(rec.attributes.clicked_count),
      }));
      if (rows.length > 0 && !opts.quiet) {
        printTable(rows);
      }
      printInfo(`${rows.length} campaign(s)`, opts);
    });

  campaigns
    .command('get <campaignId>')
    .description('Show a single campaign mailing')
    .option('--with-images', 'Include image data')
    .action(async (campaignId: string, cmdOpts: CampaignGetCmdOptions) => {
      const opts = program.opts<OutputOptions>();

      const params: GetCampaignParams = {};
      if (cmdOpts.withImages) params.withImages = true;

      const client = await createClient();
      const result = await client.getCampaign(campaignId, params);

      if (opts.json) {
        printJson(result);
        return;
      }

      const record = result.data;
      if (!record) {
        throw new ConfigError(
          `Campaign "${campaignId}" not found.`,
          'Check the campaign ID with `paubox marketing campaigns list`.',
        );
      }

      const attrs = record.attributes;
      printInfo(`ID:            ${record.id}`, opts);
      printInfo(`Subject:       ${dash(attrs.subject)}`, opts);
      printInfo(`Default subj:  ${dash(attrs.default_subject)}`, opts);
      printInfo(`Template type: ${dash(attrs.template_type)}`, opts);
      printInfo(`Sent count:    ${dash(attrs.sent_count)}`, opts);
      printInfo(`Created:       ${dash(attrs.created_at)}`, opts);
      printInfo(`Updated:       ${dash(attrs.updated_at)}`, opts);
    });
}

function registerAnalyticsCommands(marketing: Command): void {
  marketing
    .command('analytics <type>')
    .description(`Fetch a marketing analytics report: ${MARKETING_ANALYTICS_TYPES.join(', ')}`)
    .option('--campaign-mailing-send-id <id>', 'Campaign mailing send ID')
    .option('--campaign-mailing-id <id>', 'Campaign mailing ID')
    .option('--drip-campaign-id <id>', 'Drip campaign ID')
    .option('--email-type <type>', 'Filter by email type')
    .option('--html-id <id>', 'Tracking link HTML ID')
    .option('--search <text>', 'Search text')
    .option('--start-date <date>', 'Start date (ISO 8601)')
    .option('--end-date <date>', 'End date (ISO 8601)')
    .option('--by-date', 'Group totals by date')
    .option('--date-offset <n>', 'Day offset used when --by-date has no explicit range')
    .option('--with-stats', 'Include per-row statistics')
    .option('--order-by <col>', 'Sort column')
    .option('--order <asc|desc>', 'Sort direction')
    .action(async (type: string, cmdOpts: AnalyticsCmdOptions) => {
      const analyticsType = parseChoice<MarketingAnalyticsType>(
        type,
        'analytics type',
        MARKETING_ANALYTICS_TYPES,
      );

      const params: MarketingAnalyticsParams = {};
      if (cmdOpts.campaignMailingSendId !== undefined) {
        params.campaignMailingSendId = cmdOpts.campaignMailingSendId;
      }
      if (cmdOpts.campaignMailingId !== undefined) {
        params.campaignMailingId = cmdOpts.campaignMailingId;
      }
      if (cmdOpts.dripCampaignId !== undefined) params.dripCampaignId = cmdOpts.dripCampaignId;
      if (cmdOpts.emailType !== undefined) params.emailType = cmdOpts.emailType;
      if (cmdOpts.htmlId !== undefined) params.htmlId = cmdOpts.htmlId;
      if (cmdOpts.search !== undefined) params.search = cmdOpts.search;
      if (cmdOpts.startDate !== undefined) params.startDate = cmdOpts.startDate;
      if (cmdOpts.endDate !== undefined) params.endDate = cmdOpts.endDate;
      if (cmdOpts.byDate) params.byDate = true;
      if (cmdOpts.dateOffset !== undefined) {
        params.dateOffset = parseIntStrict(cmdOpts.dateOffset, '--date-offset');
      }
      if (cmdOpts.withStats) params.withStats = true;
      if (cmdOpts.orderBy !== undefined) params.orderBy = cmdOpts.orderBy;
      if (cmdOpts.order !== undefined) {
        params.order = parseChoice(cmdOpts.order, '--order', ORDER_DIRECTIONS);
      }

      const client = await createClient();
      const result = await client.getAnalytics(analyticsType, params);

      // Each report has its own shape, so JSON is the only faithful rendering.
      printJson(result);
    });
}

function registerJobCommands(marketing: Command, program: Command): void {
  const jobs = marketing
    .command('jobs')
    .description('Inspect marketing bulk jobs');

  jobs
    .command('list')
    .description('List in-flight and recently completed bulk jobs')
    .action(async () => {
      const opts = program.opts<OutputOptions>();

      const client = await createClient();
      const result = await client.listBulkJobs();

      if (opts.json) {
        printJson(result);
        return;
      }

      const rows = (result.data ?? []).map((job) => ({
        TOTAL: dash(job.total_jobs),
        PENDING: dash(job.pending),
        FAILURES: dash(job.failures),
      }));
      if (rows.length === 0) {
        printInfo('No active bulk jobs.', opts);
        return;
      }
      if (!opts.quiet) {
        printTable(rows);
      }
    });

  jobs
    .command('get <bid>')
    .description('Show the status of a bulk job by batch ID')
    .action(async (bid: string) => {
      const opts = program.opts<OutputOptions>();

      const client = await createClient();
      const result = await client.getBulkJob(bid);

      if (opts.json) {
        printJson(result);
        return;
      }

      const job = result.data;
      printInfo(`Total jobs: ${dash(job.total_jobs)}`, opts);
      printInfo(`Pending:    ${dash(job.pending)}`, opts);
      printInfo(`Failures:   ${dash(job.failures)}`, opts);
    });
}
