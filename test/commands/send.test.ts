import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/index';
import * as credentials from '../../src/lib/credentials';
import * as configStore from '../../src/lib/config-store';
import { PauboxApiClient } from '../../src/lib/api';

jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/api', () => ({
  PauboxApiClient: jest.fn(),
  resolveAttachments: jest.requireActual('../../src/lib/api').resolveAttachments,
}));

const mockCredentials = credentials as jest.Mocked<typeof credentials>;
const MockPauboxApiClient = PauboxApiClient as jest.MockedClass<typeof PauboxApiClient>;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-send-'));
  configStore.setConfigDir(tmpDir);
  jest.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  configStore.setConfigDir('');
});

describe('paubox send', () => {
  const baseCreds = { apiUsername: 'user', apiKey: 'key' };

  it('throws AuthError when not authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(null);
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'send',
        '--to', 'to@example.com',
        '--from', 'from@example.com',
        '--subject', 'Hi',
        '--text', 'Hello',
      ]),
    ).rejects.toThrow();
  });

  it('sends email and prints tracking ID', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(baseCreds);
    MockPauboxApiClient.prototype.sendEmail = jest.fn().mockResolvedValue({
      sourceTrackingId: 'abc-123',
      data: 'Service accepted',
    });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'send',
      '--to', 'to@example.com',
      '--from', 'from@example.com',
      '--subject', 'Hi',
      '--text', 'Hello',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('abc-123');
    writeSpy.mockRestore();
  });

  it('uses defaultFrom from config when --from is omitted', async () => {
    configStore.setConfigValue('defaultFrom', 'default@example.com');
    mockCredentials.loadCredentials.mockResolvedValue(baseCreds);
    MockPauboxApiClient.prototype.sendEmail = jest.fn().mockResolvedValue({
      sourceTrackingId: 'xyz',
      data: 'ok',
    });
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'send',
      '--to', 'to@example.com',
      '--subject', 'Hi',
      '--text', 'Hello',
    ]);

    const callArg = (MockPauboxApiClient.prototype.sendEmail as jest.Mock).mock.calls[0][0];
    expect(callArg.from).toBe('default@example.com');
  });

  it('outputs JSON with --json flag', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(baseCreds);
    MockPauboxApiClient.prototype.sendEmail = jest.fn().mockResolvedValue({
      sourceTrackingId: 'abc-123',
      data: 'ok',
    });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'send',
      '--to', 'to@example.com',
      '--from', 'from@example.com',
      '--subject', 'Hi',
      '--text', 'Hello',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.sourceTrackingId).toBe('abc-123');
    writeSpy.mockRestore();
  });

  it('throws when no body provided', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(baseCreds);
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'send',
        '--to', 'to@example.com',
        '--from', 'from@example.com',
        '--subject', 'Hi',
      ]),
    ).rejects.toThrow();
  });

  it('sends with attachment', async () => {
    const filePath = path.join(tmpDir, 'doc.txt');
    fs.writeFileSync(filePath, 'content');
    mockCredentials.loadCredentials.mockResolvedValue(baseCreds);
    MockPauboxApiClient.prototype.sendEmail = jest.fn().mockResolvedValue({ sourceTrackingId: 'x', data: 'ok' });
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'send',
      '--to', 'to@example.com',
      '--from', 'from@example.com',
      '--subject', 'Hi',
      '--text', 'Hello',
      '--attachment', filePath,
    ]);

    const callArg = (MockPauboxApiClient.prototype.sendEmail as jest.Mock).mock.calls[0][0];
    expect(callArg.attachments).toHaveLength(1);
    expect(callArg.attachments[0].fileName).toBe('doc.txt');
  });
});
