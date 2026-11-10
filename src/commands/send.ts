import type { Command } from 'commander';
import { PauboxApiClient, resolveAttachments } from '../lib/api';
import * as credentials from '../lib/credentials';
import * as configStore from '../lib/config-store';
import { AuthError, ConfigError } from '../lib/errors';
import { validateMessage } from '../lib/validate';
import { printJson, printSuccess } from '../lib/output';
import type { OutputOptions } from '../types';

export function registerSendCommand(program: Command): void {
  program
    .command('send')
    .description('Send a secure email via Paubox')
    .requiredOption('--to <email...>', 'Recipient email address (repeatable)')
    .option('--from <email>', 'Sender email address')
    .requiredOption('--subject <subject>', 'Email subject')
    .option('--text <body>', 'Plain text body')
    .option('--html <body>', 'HTML body')
    .option('--attachment <file...>', 'Attachment file path (repeatable)')
    .action(async (cmdOpts: {
      to: string[];
      from?: string;
      subject: string;
      text?: string;
      html?: string;
      attachment?: string[];
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

      // Credentials are checked after local validation so a badly composed
      // message reports what is wrong with it, not a missing key.
      const creds = await credentials.loadCredentials();
      if (!creds?.apiKey) throw AuthError.missing('email');

      const client = new PauboxApiClient(creds);
      const result = await client.sendEmail({
        to: cmdOpts.to,
        from,
        subject: cmdOpts.subject,
        text: cmdOpts.text,
        html: cmdOpts.html,
        attachments,
      });

      if (opts.json) {
        printJson({ sourceTrackingId: result.sourceTrackingId });
      } else {
        printSuccess(
          `Email sent. Tracking ID: ${result.sourceTrackingId}`,
          opts,
        );
      }
    });
}
