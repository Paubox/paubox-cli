import type { Command } from 'commander';
import { PauboxApiClient } from '../lib/api';
import * as credentials from '../lib/credentials';
import { AuthError } from '../lib/errors';
import { printInfo, printJson, printSuccess, printTable } from '../lib/output';
import type { OutputOptions } from '../types';

async function requireClient(): Promise<PauboxApiClient> {
  const creds = await credentials.loadCredentials();
  if (!creds?.apiKey) throw new AuthError('Not authenticated.');
  return new PauboxApiClient(creds);
}

export function registerWebhookCommands(program: Command): void {
  const webhooks = program
    .command('webhooks')
    .description('Manage webhook endpoints');

  webhooks
    .command('list')
    .description('List webhook endpoints')
    .action(async () => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.listWebhookEndpoints();

      if (opts.json) {
        printJson(result);
        return;
      }

      if (result.length === 0) {
        printInfo('No webhook endpoints found.', opts);
        return;
      }

      printTable(
        result.map((w) => ({
          id: String(w.id),
          target_url: w.target_url,
          events: w.events.join(', '),
          active: String(w.active),
        })),
      );
    });

  webhooks
    .command('create')
    .description('Create a webhook endpoint')
    .requiredOption('--url <url>', 'Target URL')
    .requiredOption('--events <events...>', 'Event types')
    .option('--signing-key <key>', 'Signing key')
    .option('--active', 'Set active (default true)')
    .option('--inactive', 'Set inactive')
    .action(async (cmdOpts: {
      url: string;
      events: string[];
      signingKey?: string;
      active?: boolean;
      inactive?: boolean;
    }) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      let active: boolean | undefined;
      if (cmdOpts.inactive) active = false;
      else if (cmdOpts.active) active = true;
      const result = await client.createWebhookEndpoint(
        cmdOpts.url,
        cmdOpts.events,
        cmdOpts.signingKey,
        active,
      );

      if (opts.json) {
        printJson(result);
      } else {
        printSuccess(`Webhook endpoint created: ${result.data.id}`, opts);
      }
    });

  webhooks
    .command('get <id>')
    .description('Get a webhook endpoint')
    .action(async (id: string) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.getWebhookEndpoint(parseInt(id, 10));

      if (opts.json) {
        printJson(result);
      } else {
        const w = result.data;
        printInfo(`ID:         ${w.id}`, opts);
        printInfo(`Target URL: ${w.target_url}`, opts);
        printInfo(`Events:     ${w.events.join(', ')}`, opts);
        printInfo(`Active:     ${w.active}`, opts);
      }
    });

  webhooks
    .command('update <id>')
    .description('Update a webhook endpoint')
    .option('--url <url>', 'Target URL')
    .option('--events <events...>', 'Event types')
    .option('--active', 'Set active')
    .option('--inactive', 'Set inactive')
    .action(async (id: string, cmdOpts: {
      url?: string;
      events?: string[];
      active?: boolean;
      inactive?: boolean;
    }) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const changes: Record<string, unknown> = {};
      if (cmdOpts.url !== undefined) changes.target_url = cmdOpts.url;
      if (cmdOpts.events !== undefined) changes.events = cmdOpts.events;
      if (cmdOpts.inactive) changes.active = false;
      else if (cmdOpts.active) changes.active = true;
      const result = await client.updateWebhookEndpoint(parseInt(id, 10), changes);

      if (opts.json) {
        printJson(result);
      } else {
        printSuccess(`Webhook endpoint ${id} updated.`, opts);
      }
    });

  webhooks
    .command('delete <id>')
    .description('Delete a webhook endpoint')
    .action(async (id: string) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      await client.deleteWebhookEndpoint(parseInt(id, 10));

      if (opts.json) {
        printJson({ status: 'ok', id });
      } else {
        printSuccess(`Webhook endpoint ${id} deleted.`, opts);
      }
    });
}
