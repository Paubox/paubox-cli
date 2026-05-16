import type { Command } from 'commander';
import { PauboxApiClient, resolveAttachments } from '../lib/api';
import * as credentials from '../lib/credentials';
import * as configStore from '../lib/config-store';
import { AuthError, ConfigError } from '../lib/errors';
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

      const creds = await credentials.loadCredentials();
      if (!creds) throw new AuthError('Not authenticated.');

      const from = cmdOpts.from ?? configStore.getConfigValue('defaultFrom');
      if (!from) {
        throw new ConfigError(
          'No sender address specified.',
          'Use --from <email> or run `paubox config set defaultFrom <email>`.',
        );
      }

      if (!cmdOpts.text && !cmdOpts.html) {
        throw new ConfigError('Provide at least one of --text or --html.');
      }

      const attachments = cmdOpts.attachment ? resolveAttachments(cmdOpts.attachment) : [];

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
