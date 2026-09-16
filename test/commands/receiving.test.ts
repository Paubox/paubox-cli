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
  it('prints received emails', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue([
      { id: 100 },
      { id: 101 },
    ]);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'list',
    ]);

    const output = collectOutput(spy);
    expect(output).toContain('100');
    expect(output).toContain('101');
    spy.mockRestore();
  });

  it('passes query params', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue([]);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'list',
      '--limit', '5', '--after', 'cursor-abc',
    ]);

    expect(MockPauboxApiClient.prototype.listReceivedEmails).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, after: 'cursor-abc' }),
    );
    spy.mockRestore();
  });

  it('prints message when empty', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.listReceivedEmails = jest.fn().mockResolvedValue([]);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'list',
    ]);

    expect(collectOutput(spy)).toContain('No received emails found.');
    spy.mockRestore();
  });
});

describe('paubox receiving emails get', () => {
  it('prints received email', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    const email = { id: 42, subject: 'Hello' };
    MockPauboxApiClient.prototype.getReceivedEmail = jest.fn().mockResolvedValue(email);
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'get', '42',
    ]);

    const parsed = JSON.parse(collectOutput(spy));
    expect(parsed).toEqual(email);
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

  it('downloads attachment to --output path', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.downloadAttachment = jest.fn().mockResolvedValue(
      Buffer.from('file-data'),
    );
    const outPath = path.join(tmpDir, 'downloaded.bin');
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'receiving', 'emails', 'attachment', '42', 'blob-1',
      '--output', outPath,
    ]);

    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.readFileSync(outPath).toString()).toBe('file-data');
    expect(collectOutput(spy)).toContain(outPath);
    expect(MockPauboxApiClient.prototype.downloadAttachment).toHaveBeenCalledWith('42', 'blob-1');
    spy.mockRestore();
  });

  it('defaults output filename to attachment-{blobId}', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.downloadAttachment = jest.fn().mockResolvedValue(
      Buffer.from('data'),
    );
    const spy = captureStdout();

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await createProgram().parseAsync([
        'node', 'paubox', 'receiving', 'emails', 'attachment', '42', 'blob-1',
      ]);
    } finally {
      process.chdir(origCwd);
    }

    expect(collectOutput(spy)).toContain('attachment-blob-1');
    spy.mockRestore();
  });

  it('outputs JSON with --json', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'k' });
    MockPauboxApiClient.prototype.downloadAttachment = jest.fn().mockResolvedValue(
      Buffer.from('data'),
    );
    const outPath = path.join(tmpDir, 'out.bin');
    const spy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'receiving', 'emails', 'attachment', '42', 'blob-1',
      '--output', outPath,
    ]);

    const parsed = JSON.parse(collectOutput(spy));
    expect(parsed.status).toBe('ok');
    expect(parsed.emailId).toBe('42');
    expect(parsed.blobId).toBe('blob-1');
    spy.mockRestore();
  });
});
