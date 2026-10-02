import type { Command } from 'commander';
import { PauboxApiClient } from '../lib/api';
import * as credentials from '../lib/credentials';
import { safeFilename, writeExportFile } from '../lib/file-write';
import { AuthError } from '../lib/errors';
import { printInfo, printJson, printSuccess, printTable } from '../lib/output';
import type { OutputOptions, ReceivedEmailAddress } from '../types';

async function requireClient(): Promise<PauboxApiClient> {
  const creds = await credentials.loadCredentials();
  if (!creds?.apiKey) throw new AuthError('Not authenticated.');
  return new PauboxApiClient(creds);
}

function oneLine(value: string | null | undefined): string {
  return (value ?? '').replace(/\p{Cc}/gu, ' ').replace(/\p{Bidi_Control}/gu, '');
}

function multiLine(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\n\t]/gu, '');
}

function formatAddresses(addresses: ReceivedEmailAddress[]): string {
  return addresses
    .map((a) => (a.name && a.address ? `${a.name} <${a.address}>` : a.address ?? a.name ?? ''))
    .filter((a) => a !== '')
    .map(oneLine)
    .join(', ');
}

export function registerReceivingCommands(program: Command): void {
  const receiving = program
    .command('receiving')
    .description('Manage inbound email receiving');

  const domains = receiving
    .command('domains')
    .description('Manage receiving domains');

  domains
    .command('list')
    .description('List receiving domains')
    .action(async () => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.listReceivingDomains();

      if (opts.json) {
        printJson(result);
        return;
      }

      if (result.length === 0) {
        printInfo('No receiving domains found.', opts);
        return;
      }

      printTable(
        result.map((d) => ({
          id: String(d.id),
          slug: d.slug,
        })),
      );
    });

  domains
    .command('create')
    .description('Create a receiving domain')
    .option('--slug <slug>', 'Domain slug')
    .action(async (cmdOpts: { slug?: string }) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.createReceivingDomain(cmdOpts.slug);

      if (opts.json) {
        printJson(result);
      } else {
        printSuccess(`Receiving domain created: ${result.id} (${result.slug})`, opts);
      }
    });

  domains
    .command('get <id>')
    .description('Get a receiving domain')
    .action(async (id: string) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.getReceivingDomain(id);

      if (opts.json) {
        printJson(result);
      } else {
        printInfo(`ID:   ${result.id}`, opts);
        printInfo(`Slug: ${result.slug}`, opts);
      }
    });

  domains
    .command('delete <id>')
    .description('Delete a receiving domain')
    .action(async (id: string) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      await client.deleteReceivingDomain(id);

      if (opts.json) {
        printJson({ status: 'ok', id });
      } else {
        printSuccess(`Receiving domain ${id} deleted.`, opts);
      }
    });

  const mailboxes = receiving
    .command('mailboxes')
    .description('Manage mailboxes');

  mailboxes
    .command('list <domainId>')
    .description('List mailboxes for a receiving domain')
    .action(async (domainId: string) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.listMailboxes(domainId);

      if (opts.json) {
        printJson(result);
        return;
      }

      if (result.length === 0) {
        printInfo('No mailboxes found.', opts);
        return;
      }

      printTable(
        result.map((m) => ({
          id: String(m.id),
          name: m.name,
        })),
      );
    });

  mailboxes
    .command('create <domainId>')
    .description('Create a mailbox')
    .requiredOption('--name <name>', 'Mailbox name')
    .requiredOption('--password <password>', 'Mailbox password')
    .option('--quota-bytes <n>', 'Mailbox quota in bytes')
    .action(async (domainId: string, cmdOpts: {
      name: string;
      password: string;
      quotaBytes?: string;
    }) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.createMailbox(domainId, {
        name: cmdOpts.name,
        password: cmdOpts.password,
        ...(cmdOpts.quotaBytes !== undefined
          ? { quota_bytes: parseInt(cmdOpts.quotaBytes, 10) }
          : {}),
      });

      if (opts.json) {
        printJson(result);
      } else {
        printSuccess(`Mailbox created: ${result.id} (${result.name})`, opts);
      }
    });

  mailboxes
    .command('get <domainId> <mailboxId>')
    .description('Get a mailbox')
    .action(async (domainId: string, mailboxId: string) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.getMailbox(domainId, mailboxId);

      if (opts.json) {
        printJson(result);
      } else {
        printInfo(`ID:   ${result.id}`, opts);
        printInfo(`Name: ${result.name}`, opts);
      }
    });

  mailboxes
    .command('delete <domainId> <mailboxId>')
    .description('Delete a mailbox')
    .action(async (domainId: string, mailboxId: string) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      await client.deleteMailbox(domainId, mailboxId);

      if (opts.json) {
        printJson({ status: 'ok', domainId, mailboxId });
      } else {
        printSuccess(`Mailbox ${mailboxId} deleted.`, opts);
      }
    });

  const emails = receiving
    .command('emails')
    .description('Manage received emails');

  emails
    .command('list')
    .description('List received emails')
    .option('--limit <n>', 'Maximum number of results (default 25, max 100)')
    .option('--after <emailId>', 'Return the page after this email_id')
    .option('--before <emailId>', 'Return the page before this email_id')
    .action(async (cmdOpts: {
      limit?: string;
      after?: string;
      before?: string;
    }) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.listReceivedEmails({
        ...(cmdOpts.limit !== undefined
          ? { limit: parseInt(cmdOpts.limit, 10) }
          : {}),
        after: cmdOpts.after,
        before: cmdOpts.before,
      });

      if (opts.json) {
        printJson(result);
        return;
      }

      if (result.data.length === 0) {
        printInfo('No received emails found.', opts);
        return;
      }

      printTable(
        result.data.map((e) => ({
          email_id: oneLine(e.email_id),
          received_at: oneLine(e.received_at),
          from: formatAddresses(e.from),
          subject: oneLine(e.subject),
        })),
      );

      if (result.has_more) {
        printInfo(`More results: --after ${oneLine(result.data[result.data.length - 1].email_id)}`, opts);
      }
    });

  emails
    .command('get <emailId>')
    .description('Get a received email')
    .action(async (emailId: string) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const result = await client.getReceivedEmail(emailId);

      if (opts.json) {
        printJson(result);
        return;
      }

      const email = result.data;
      printInfo(`Email ID: ${oneLine(email.email_id)}`, opts);
      printInfo(`From:     ${formatAddresses(email.from)}`, opts);
      printInfo(`To:       ${formatAddresses(email.to)}`, opts);
      if (email.cc.length > 0) printInfo(`Cc:       ${formatAddresses(email.cc)}`, opts);
      printInfo(`Subject:  ${oneLine(email.subject)}`, opts);
      printInfo(`Received: ${oneLine(email.received_at)}`, opts);
      printInfo(`Spam:     ${email.spam}`, opts);

      if (email.attachments.length > 0) {
        printInfo('', opts);
        printTable(
          email.attachments.map((a) => ({
            id: oneLine(a.id),
            filename: oneLine(a.filename),
            content_type: oneLine(a.content_type),
            size: a.size === null ? '' : String(a.size),
          })),
        );
      }

      if (email.text_body) {
        printInfo('', opts);
        printInfo(multiLine(email.text_body), opts);
      }
    });

  emails
    .command('attachment <emailId> <attachmentId>')
    .description('Download an attachment from a received email')
    .option('--output <path>', 'Output file path (defaults to the attachment filename)')
    .option('--force', 'Overwrite an existing file')
    .action(async (emailId: string, attachmentId: string, cmdOpts: {
      output?: string;
      force?: boolean;
    }) => {
      const opts = program.opts<OutputOptions>();
      const client = await requireClient();
      const attachment = await client.downloadAttachment(emailId, attachmentId);

      const remoteName = attachment.filename ? safeFilename(attachment.filename) : null;
      const outputPath = cmdOpts.output ?? remoteName ?? `attachment-${attachmentId}`;
      writeExportFile(outputPath, attachment.data, cmdOpts.force ?? false);

      if (opts.json) {
        printJson({ status: 'ok', emailId, attachmentId, blobId: attachmentId, output: outputPath });
      } else {
        printSuccess(`Attachment written to ${outputPath}`, opts);
      }
    });
}
