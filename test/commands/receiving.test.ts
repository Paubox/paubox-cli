import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/index';
import * as credentials from '../../src/lib/credentials';
import { PauboxApiClient } from '../../src/lib/api';

jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/api');

const mockCredentials = credentials as jest.Mocked<typeof credentials>;
const MockPauboxApiClient = PauboxApiClient as jest.MockedClass<typeof PauboxApiClient>;

beforeEach(() => {
  jest.clearAllMocks();
});

function captureStdout(): jest.SpyInstance {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

function collectOutput(spy: jest.SpyInstance): string {
  return spy.mock.calls.map((c: unknown[]) => c[0]).join('');
}

const EMAIL_ID = '0192f0c4-0000-7000-8000-000000000001';
const EMAIL_ID_2 = '0192f0c4-0000-7000-8000-000000000002';
const ATTACHMENT_ID = '0192f0c4-0000-7000-8000-0000000000a1';

function listItem(emailId: string, subject: string) {
  return {
    email_id: emailId,
    from: [{ name: 'Alice', address: 'alice@example.com' }],
    to: [{ name: null, address: 'inbox@example.com' }],
    subject,
    received_at: '2026-10-01T12:00:00Z',
    has_attachment: false,
    spam: false,
    size: 1024,
    domain: 'example.com',
  };
}

function emailDetail(overrides: Record<string, unknown> = {}) {
  return {
    email_id: EMAIL_ID,
    from: [{ name: 'Alice', address: 'alice@example.com' }],
    to: [{ name: null, address: 'inbox@example.com' }],
    cc: [],
    subject: 'Hello',
    date: '2026-10-01T11:59:00Z',
    received_at: '2026-10-01T12:00:00Z',
    message_id: ['<m1@example.com>'],
    in_reply_to: null,
    references: null,
    spam: false,
    spam_score: 0.1,
    text_body: 'Hi there',
    html_body: null,
    attachments: [
      {
        id: ATTACHMENT_ID,
        filename: 'report.pdf',
        content_type: 'application/pdf',
        size: 2048,
        content_id: null,
        download_url: `https://api.paubox.com/v1/email/receiving/${EMAIL_ID}/attachments/${ATTACHMENT_ID}`,
      },
    ],
    size: 4096,
    authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    domain: 'example.com',
    headers: null,
    ...overrides,
  };
}

function mockDownload(data: string, filename: string | null) {
  MockPauboxApiClient.prototype.downloadAttachment = jest.fn().mockResolvedValue({
    data: Buffer.from(data),
    filename,
    contentType: 'application/pdf',
  });
}

async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(origCwd);
  }
}

describe('paubox receiving domains list', () => {
  it('throws AuthError when not authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(null);
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'receiving', 'domains', 'list']),
    ).rejects.toThrow('Not authenticated.');
  });

  it('prints a table of domains', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivingDomains = jest.fn().mockResolvedValue([
      { id: 1, slug: 'example.com' },
      { id: 2, slug: 'test.com' },
    ]);
    const spy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'receiving', 'domains', 'list']);

    const output = collectOutput(spy);
    expect(output).toContain('example.com');
    expect(output).toContain('test.com');
    spy.mockRestore();
  });

  it('prints message when no domains exist', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivingDomains = jest.fn().mockResolvedValue([]);
    const spy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'receiving', 'domains', 'list']);

    expect(collectOutput(spy)).toContain('No receiving domains found.');
    spy.mockRestore();
  });

  it('outputs JSON with --json', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    const data = [{ id: 1, slug: 'example.com' }];
    MockPauboxApiClient.prototype.listReceivingDomains = jest.fn().mockResolvedValue(data);
    const spy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'receiving', 'domains', 'list']);

    const parsed = JSON.parse(collectOutput(spy));
    expect(parsed).toEqual(data);
    spy.mockRestore();
  });
});

describe('paubox receiving domains create', () => {
  it('creates a domain with --slug', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.createReceivingDomain = jest.fn().mockResolvedValue({
      id: 5, slug: 'new.com',
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'domains', 'create', '--slug', 'new.com',
    ]);

    expect(collectOutput(spy)).toContain('new.com');
    expect(MockPauboxApiClient.prototype.createReceivingDomain).toHaveBeenCalledWith('new.com');
    spy.mockRestore();
  });

  it('creates a domain without --slug', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.createReceivingDomain = jest.fn().mockResolvedValue({
      id: 6, slug: 'auto.com',
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'domains', 'create',
    ]);

    expect(MockPauboxApiClient.prototype.createReceivingDomain).toHaveBeenCalledWith(undefined);
    spy.mockRestore();
  });
});

describe('paubox receiving domains get', () => {
  it('prints domain details', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.getReceivingDomain = jest.fn().mockResolvedValue({
      id: 1, slug: 'example.com',
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'domains', 'get', '1',
    ]);

    const output = collectOutput(spy);
    expect(output).toContain('1');
    expect(output).toContain('example.com');
    spy.mockRestore();
  });

  it('outputs JSON with --json', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    const domain = { id: 1, slug: 'example.com' };
    MockPauboxApiClient.prototype.getReceivingDomain = jest.fn().mockResolvedValue(domain);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'receiving', 'domains', 'get', '1',
    ]);

    expect(JSON.parse(collectOutput(spy))).toEqual(domain);
    spy.mockRestore();
  });
});

describe('paubox receiving domains delete', () => {
  it('deletes a domain', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.deleteReceivingDomain = jest.fn().mockResolvedValue(undefined);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'domains', 'delete', '1',
    ]);

    expect(collectOutput(spy)).toContain('deleted');
    expect(MockPauboxApiClient.prototype.deleteReceivingDomain).toHaveBeenCalledWith('1');
    spy.mockRestore();
  });
});

describe('paubox receiving mailboxes list', () => {
  it('prints a table of mailboxes', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listMailboxes = jest.fn().mockResolvedValue([
      { id: 1, name: 'info' },
      { id: 2, name: 'support' },
    ]);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'mailboxes', 'list', '3',
    ]);

    const output = collectOutput(spy);
    expect(output).toContain('info');
    expect(output).toContain('support');
    expect(MockPauboxApiClient.prototype.listMailboxes).toHaveBeenCalledWith('3');
    spy.mockRestore();
  });

  it('prints message when no mailboxes', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listMailboxes = jest.fn().mockResolvedValue([]);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'mailboxes', 'list', '3',
    ]);

    expect(collectOutput(spy)).toContain('No mailboxes found.');
    spy.mockRestore();
  });
});

describe('paubox receiving mailboxes create', () => {
  it('creates a mailbox with required and optional args', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.createMailbox = jest.fn().mockResolvedValue({
      id: 10, name: 'support',
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'mailboxes', 'create', '3',
      '--name', 'support', '--password', 'secret', '--quota-bytes', '1073741824',
    ]);

    expect(collectOutput(spy)).toContain('support');
    expect(MockPauboxApiClient.prototype.createMailbox).toHaveBeenCalledWith('3', {
      name: 'support',
      password: 'secret',
      quota_bytes: 1073741824,
    });
    spy.mockRestore();
  });

  it('creates a mailbox without optional quota', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.createMailbox = jest.fn().mockResolvedValue({
      id: 11, name: 'test',
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'mailboxes', 'create', '3',
      '--name', 'test', '--password', 'pw',
    ]);

    expect(MockPauboxApiClient.prototype.createMailbox).toHaveBeenCalledWith('3', {
      name: 'test',
      password: 'pw',
    });
    spy.mockRestore();
  });
});

describe('paubox receiving mailboxes get', () => {
  it('prints mailbox details', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.getMailbox = jest.fn().mockResolvedValue({
      id: 10, name: 'support',
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'mailboxes', 'get', '3', '10',
    ]);

    const output = collectOutput(spy);
    expect(output).toContain('10');
    expect(output).toContain('support');
    spy.mockRestore();
  });
});

describe('paubox receiving mailboxes delete', () => {
  it('deletes a mailbox', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.deleteMailbox = jest.fn().mockResolvedValue(undefined);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'mailboxes', 'delete', '3', '10',
    ]);

    expect(collectOutput(spy)).toContain('deleted');
    expect(MockPauboxApiClient.prototype.deleteMailbox).toHaveBeenCalledWith('3', '10');
    spy.mockRestore();
  });
});

describe('paubox receiving emails list', () => {
  it('prints email_id, sender and subject columns', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue({
      object: 'list',
      data: [listItem(EMAIL_ID, 'First'), listItem(EMAIL_ID_2, 'Second')],
      has_more: false,
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'list',
    ]);

    const output = collectOutput(spy);
    expect(output).toContain('email_id');
    expect(output).toContain(EMAIL_ID);
    expect(output).toContain(EMAIL_ID_2);
    expect(output).toContain('Alice <alice@example.com>');
    expect(output).toContain('Second');
    expect(output).not.toContain('More results');
    spy.mockRestore();
  });

  it('prints the next-page cursor when has_more is true', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue({
      object: 'list',
      data: [listItem(EMAIL_ID, 'First'), listItem(EMAIL_ID_2, 'Second')],
      has_more: true,
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'list',
    ]);

    expect(collectOutput(spy)).toContain(`More results: --after ${EMAIL_ID_2}`);
    spy.mockRestore();
  });

  it('renders null subject and received_at as blanks', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue({
      object: 'list',
      data: [{
        ...listItem(EMAIL_ID, 'x'),
        subject: null,
        received_at: null,
        from: [{ name: 'No Address', address: null }],
      }],
      has_more: false,
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'list',
    ]);

    const output = collectOutput(spy);
    expect(output).toContain(EMAIL_ID);
    expect(output).toContain('No Address');
    expect(output).not.toContain('null');
    spy.mockRestore();
  });

  it('passes query params', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue({
      object: 'list',
      data: [],
      has_more: false,
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'list',
      '--limit', '5', '--after', EMAIL_ID,
    ]);

    expect(MockPauboxApiClient.prototype.listReceivedEmails).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, after: EMAIL_ID }),
    );
    spy.mockRestore();
  });

  it('prints message when empty', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue({
      object: 'list',
      data: [],
      has_more: false,
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'list',
    ]);

    expect(collectOutput(spy)).toContain('No received emails found.');
    spy.mockRestore();
  });

  it('outputs the API list envelope with --json', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    const list = { object: 'list', data: [listItem(EMAIL_ID, 'First')], has_more: true };
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue(list);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'receiving', 'emails', 'list',
    ]);

    expect(JSON.parse(collectOutput(spy))).toEqual(list);
    spy.mockRestore();
  });
});

describe('paubox receiving emails get', () => {
  it('prints the email summary with attachment id and filename', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.getReceivedEmail = jest.fn().mockResolvedValue({
      data: emailDetail({ cc: [{ name: null, address: 'cc@example.com' }] }),
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'get', EMAIL_ID,
    ]);

    const output = collectOutput(spy);
    expect(MockPauboxApiClient.prototype.getReceivedEmail).toHaveBeenCalledWith(EMAIL_ID);
    expect(output).toContain(`Email ID: ${EMAIL_ID}`);
    expect(output).toContain('Alice <alice@example.com>');
    expect(output).toContain('Cc:       cc@example.com');
    expect(output).toContain('Subject:  Hello');
    expect(output).toContain(ATTACHMENT_ID);
    expect(output).toContain('report.pdf');
    expect(output).toContain('2048');
    expect(output).toContain('Hi there');
    spy.mockRestore();
  });

  it('omits empty sections and blanks null fields', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.getReceivedEmail = jest.fn().mockResolvedValue({
      data: emailDetail({
        subject: null,
        received_at: null,
        text_body: null,
        attachments: [{
          id: ATTACHMENT_ID,
          filename: null,
          content_type: null,
          size: null,
          content_id: null,
          download_url: 'u',
        }],
      }),
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'get', EMAIL_ID,
    ]);

    const output = collectOutput(spy);
    expect(output).not.toContain('Cc:');
    expect(output).not.toContain('null');
    expect(output).toContain(ATTACHMENT_ID);
    spy.mockRestore();
  });

  it('skips the attachment table when there are none', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.getReceivedEmail = jest.fn().mockResolvedValue({
      data: emailDetail({ attachments: [] }),
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'get', EMAIL_ID,
    ]);

    expect(collectOutput(spy)).not.toContain('filename');
    spy.mockRestore();
  });

  it('strips terminal control sequences from sender-controlled text', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.getReceivedEmail = jest.fn().mockResolvedValue({
      data: emailDetail({
        from: [{ name: 'Eve\u001b]0;pwned\u0007', address: 'eve@example.com' }],
        subject: 'Hi\u001b[2J\nthere',
        text_body: 'line1\r\nline2\u001b[31m\tred',
        attachments: [{
          id: ATTACHMENT_ID,
          filename: 'invoice\u202Efdp.exe',
          content_type: 'application/pdf',
          size: 1,
          content_id: null,
          download_url: 'u',
        }],
      }),
    });
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'get', EMAIL_ID,
    ]);

    const output = collectOutput(spy);
    expect(output).not.toContain('\u001b]');
    expect(output).not.toContain('\u001b[2J');
    expect(output).not.toContain('\u001b[31m');
    expect(output).not.toContain('\u0007');
    expect(output).not.toContain('\u202E');
    expect(output).not.toContain('\r');
    expect(output).toContain('Subject:  Hi [2J there');
    expect(output).toContain('line1\nline2[31m\tred');
    expect(output).toContain('invoicefdp.exe');
    spy.mockRestore();
  });

  it('outputs the API response with --json', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    const body = { data: emailDetail() };
    MockPauboxApiClient.prototype.getReceivedEmail = jest.fn().mockResolvedValue(body);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'receiving', 'emails', 'get', EMAIL_ID,
    ]);

    expect(JSON.parse(collectOutput(spy))).toEqual(body);
    spy.mockRestore();
  });
});

describe('paubox receiving emails attachment', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-recv-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloads the raw bytes to --output path', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    mockDownload('%PDF-1.7 raw', 'report.pdf');
    const outPath = path.join(tmpDir, 'downloaded.bin');
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'attachment', EMAIL_ID, ATTACHMENT_ID,
      '--output', outPath,
    ]);

    expect(fs.readFileSync(outPath).toString()).toBe('%PDF-1.7 raw');
    expect(fs.existsSync(path.join(tmpDir, 'report.pdf'))).toBe(false);
    expect(collectOutput(spy)).toContain(outPath);
    expect(MockPauboxApiClient.prototype.downloadAttachment).toHaveBeenCalledWith(
      EMAIL_ID,
      ATTACHMENT_ID,
    );
    spy.mockRestore();
  });

  it('defaults the output filename to the attachment filename', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    mockDownload('data', 'report.pdf');
    const spy = captureStdout();

    await inDir(tmpDir, () => createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'attachment', EMAIL_ID, ATTACHMENT_ID,
    ]));

    expect(fs.readFileSync(path.join(tmpDir, 'report.pdf')).toString()).toBe('data');
    expect(collectOutput(spy)).toContain('report.pdf');
    spy.mockRestore();
  });

  it('strips directories and leading dots from the attachment filename', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    mockDownload('data', '../../.zshenv');
    const spy = captureStdout();

    await inDir(tmpDir, () => createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'attachment', EMAIL_ID, ATTACHMENT_ID,
    ]));

    expect(fs.readdirSync(tmpDir)).toEqual(['zshenv']);
    spy.mockRestore();
  });

  it('falls back to attachment-{attachmentId} without a usable filename', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    mockDownload('data', null);
    const spy = captureStdout();

    await inDir(tmpDir, () => createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'attachment', EMAIL_ID, ATTACHMENT_ID,
    ]));

    expect(fs.readdirSync(tmpDir)).toEqual([`attachment-${ATTACHMENT_ID}`]);
    expect(collectOutput(spy)).toContain(`attachment-${ATTACHMENT_ID}`);
    spy.mockRestore();
  });

  it('refuses to overwrite an existing file without --force', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    mockDownload('new', 'report.pdf');
    fs.writeFileSync(path.join(tmpDir, 'report.pdf'), 'old');

    await expect(inDir(tmpDir, () => createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'attachment', EMAIL_ID, ATTACHMENT_ID,
    ]))).rejects.toThrow('File already exists');

    expect(fs.readFileSync(path.join(tmpDir, 'report.pdf')).toString()).toBe('old');
  });

  it('outputs JSON with attachmentId and the deprecated blobId', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    mockDownload('data', 'report.pdf');
    const outPath = path.join(tmpDir, 'out.bin');
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'receiving', 'emails', 'attachment', EMAIL_ID, ATTACHMENT_ID,
      '--output', outPath,
    ]);

    expect(JSON.parse(collectOutput(spy))).toEqual({
      status: 'ok',
      emailId: EMAIL_ID,
      attachmentId: ATTACHMENT_ID,
      blobId: ATTACHMENT_ID,
      output: outPath,
    });
    spy.mockRestore();
  });
});
