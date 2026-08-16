import type { Command } from 'commander';
import { MarketingApiClient } from '../lib/marketing-api';
import * as credentials from '../lib/credentials';
import { ConfigError } from '../lib/errors';
import { printJson, printInfo, printTable } from '../lib/output';
import {
  MARKETING_ANALYTICS_TYPES,
  type GetCampaignParams,
  type GetSubscriberParams,
  type ListCampaignsParams,
  type ListMarketingListsParams,
  type ListSubscribersParams,
  type MarketingAnalyticsParams,
  type MarketingAnalyticsType,
  type OutputOptions,
  type SubscribedCountParams,
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
  registerListCommands(marketing, program);
  registerCampaignCommands(marketing, program);
  registerAnalyticsCommands(marketing);
  registerJobCommands(marketing, program);
}

function registerSubscriberCommands(marketing: Command, program: Command): void {
  const subscribers = marketing
    .command('subscribers')
    .description('Browse marketing subscribers');

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
}

function registerListCommands(marketing: Command, program: Command): void {
  const lists = marketing.command('lists').description('Browse marketing lists');

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
