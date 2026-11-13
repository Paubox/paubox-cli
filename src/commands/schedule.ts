import type { Command } from 'commander';
import { PauboxApiClient, resolveAttachments } from '../lib/api';
import * as credentials from '../lib/credentials';
import * as configStore from '../lib/config-store';
import { AuthError, ConfigError } from '../lib/errors';
import { validateMessage, validateScheduledAt } from '../lib/validate';
import { printJson, printSuccess } from '../lib/output';
import type { OutputOptions } from '../types';

export function registerScheduleCommand(program: Command): void {
  const schedule = program
    .command('schedule')
    .description('Manage scheduled emails');

  schedule
    .command('send')
    .description('Schedule an email for future delivery')
    .requiredOption('--to <email...>', 'Recipient email address (repeatable)')
    .option('--from <email>', 'Sender email address')
    .requiredOption('--subject <subject>', 'Email subject')
    .option('--text <body>', 'Plain text body')
    .option('--html <body>', 'HTML body')
    .option('--attachment <file...>', 'Attachment file path (repeatable)')
    .requiredOption('--at <datetime>', 'Scheduled send time (ISO 8601, e.g. 2025-12-25T15:00:00Z)')
    .action(async (cmdOpts: {
      to: string[];
      from?: string;
      subject: string;
      text?: string;
      html?: string;
      attachment?: string[];
      at: string;
    }) => {
      const opts = program.opts<OutputOptions>();

      const from = cmdOpts.from ?? configStore.getConfigValue('defaultFrom');
      if (!from) {
        throw new ConfigError(
          'No sender address specified.',
          'Use --from <email> or run `paubox config set defaultFrom <email>`.',
        );
      }

      // Validate before reading the attachments off disk and before the round
      // trip: a malformed address should cost nothing and name itself.
      const attachments = cmdOpts.attachment ? resolveAttachments(cmdOpts.attachment) : [];
      validateMessage({
        to: cmdOpts.to,
        from,
        subject: cmdOpts.subject,
        text: cmdOpts.text,
        html: cmdOpts.html,
        attachments,
      });
      validateScheduledAt(cmdOpts.at);

      // Credentials are checked after local validation so a badly composed
      // message reports what is wrong with it, not a missing key.
      const creds = await credentials.loadCredentials();
      if (!creds?.apiKey) throw AuthError.missing('email');

      const client = new PauboxApiClient(creds);
      const result = await client.scheduleEmail({
        to: cmdOpts.to,
        from,
        subject: cmdOpts.subject,
        text: cmdOpts.text,
        html: cmdOpts.html,
        attachments,
        scheduledAt: cmdOpts.at,
      });

      if (opts.json) {
        printJson({
          sourceTrackingId: result.sourceTrackingId,
          scheduledAt: result.scheduledAt,
          state: result.state,
        });
      } else {
        printSuccess(
          `Email scheduled for ${result.scheduledAt}. Tracking ID: ${result.sourceTrackingId}`,
          opts,
        );
      }
    });

  schedule
    .command('status <trackingId>')
    .description('Check status of a scheduled email')
    .action(async (trackingId: string) => {
      const opts = program.opts<OutputOptions>();

      const creds = await credentials.loadCredentials();
      if (!creds?.apiKey) throw AuthError.missing('email');

      const client = new PauboxApiClient(creds);
      const result = await client.getScheduledMessage(trackingId);

      if (opts.json) {
        printJson(result);
      } else {
        printSuccess(
          `Tracking ID: ${result.sourceTrackingId}\nState: ${result.state}\nScheduled at: ${result.scheduledAt}`,
          opts,
        );
      }
    });

  schedule
    .command('reschedule <trackingId>')
    .description('Change the scheduled time of a pending email')
    .requiredOption('--at <datetime>', 'New scheduled send time (ISO 8601)')
    .action(async (trackingId: string, cmdOpts: { at: string }) => {
      const opts = program.opts<OutputOptions>();

      const creds = await credentials.loadCredentials();
      if (!creds?.apiKey) throw AuthError.missing('email');

      const client = new PauboxApiClient(creds);
      const result = await client.rescheduleMessage(trackingId, cmdOpts.at);

      if (opts.json) {
        printJson(result);
      } else {
        printSuccess(
          `Email rescheduled to ${result.scheduledAt}. Tracking ID: ${result.sourceTrackingId}`,
          opts,
        );
      }
    });

  schedule
    .command('cancel <trackingId>')
    .description('Cancel a scheduled email')
    .action(async (trackingId: string) => {
      const opts = program.opts<OutputOptions>();

      const creds = await credentials.loadCredentials();
      if (!creds?.apiKey) throw AuthError.missing('email');

      const client = new PauboxApiClient(creds);
      const result = await client.cancelScheduledMessage(trackingId);

      if (opts.json) {
        printJson(result);
      } else {
        printSuccess(
          `Scheduled email cancelled. Tracking ID: ${result.sourceTrackingId}`,
          opts,
        );
      }
    });
}
