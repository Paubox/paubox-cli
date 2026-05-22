import type { Command } from 'commander';
import { PauboxApiClient } from '../lib/api';
import * as credentials from '../lib/credentials';
import { AuthError } from '../lib/errors';
import { printInfo, printJson, printTable } from '../lib/output';
import type { MessageDelivery, OutputOptions } from '../types';

export function registerStatusCommand(program: Command): void {
  program
    .command('status <trackingId>')
    .description('Check delivery status of a sent email')
    .action(async (trackingId: string) => {
      const opts = program.opts<OutputOptions>();

      const creds = await credentials.loadCredentials();
      if (!creds) throw new AuthError('Not authenticated.');

      const client = new PauboxApiClient(creds, undefined, { verbose: opts.verbose });
      const result = await client.getMessageStatus(trackingId);

      if (opts.json) {
        printJson(result);
        return;
      }

      const deliveries: MessageDelivery[] = result.data.message.message_deliveries;
      if (deliveries.length === 0) {
        printInfo('No delivery records found for this tracking ID.', opts);
        return;
      }

      printTable(
        deliveries.map((d) => ({
          recipient: d.recipient,
          status: d.status.deliveryStatus,
          'delivered at': d.status.deliveryTime || '—',
          opened: d.status.openedStatus,
          'opened at': d.status.openedTime || '—',
        })),
      );
    });
}
