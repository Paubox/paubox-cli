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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-schedule-'));
  configStore.setConfigDir(tmpDir);
  jest.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  configStore.setConfigDir('');
});

describe('paubox schedule send', () => {
  const baseCreds = { apiKey: 'key' };

  it('throws AuthError when not authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(null);
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'schedule', 'send',
        '--to', 'to@example.com',
        '--from', 'from@example.com',
        '--subject', 'Hi',
        '--text', 'Hello',
        '--at', '2025-12-25T15:00:00Z',
      ]),
    ).rejects.toThrow();
  });

  it('schedules email and prints tracking ID', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(baseCreds);
    MockPauboxApiClient.prototype.scheduleEmail = jest.fn().mockResolvedValue({
      sourceTrackingId: 'sched-123',
      scheduledAt: '2025-12-25T15:00:00Z',
      state: 'pending',
      data: 'Service accepted',
    });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'schedule', 'send',
      '--to', 'to@example.com',
      '--from', 'from@example.com',
      '--subject', 'Hi',
      '--text', 'Hello',
      '--at', '2025-12-25T15:00:00Z',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('sched-123');
    expect(output).toContain('2025-12-25T15:00:00Z');
    writeSpy.mockRestore();
  });

  it('outputs JSON with --json flag', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(baseCreds);
    MockPauboxApiClient.prototype.scheduleEmail = jest.fn().mockResolvedValue({
      sourceTrackingId: 'sched-123',
      scheduledAt: '2025-12-25T15:00:00Z',
      state: 'pending',
      data: 'ok',
    });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'schedule', 'send',
      '--to', 'to@example.com',
      '--from', 'from@example.com',
      '--subject', 'Hi',
      '--text', 'Hello',
      '--at', '2025-12-25T15:00:00Z',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.sourceTrackingId).toBe('sched-123');
    expect(parsed.scheduledAt).toBe('2025-12-25T15:00:00Z');
    expect(parsed.state).toBe('pending');
    writeSpy.mockRestore();
  });

  it('uses defaultFrom from config', async () => {
    configStore.setConfigValue('defaultFrom', 'default@example.com');
    mockCredentials.loadCredentials.mockResolvedValue(baseCreds);
    MockPauboxApiClient.prototype.scheduleEmail = jest.fn().mockResolvedValue({
      sourceTrackingId: 'xyz',
      scheduledAt: '2025-12-25T15:00:00Z',
      state: 'pending',
      data: 'ok',
    });
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'schedule', 'send',
      '--to', 'to@example.com',
      '--subject', 'Hi',
      '--text', 'Hello',
      '--at', '2025-12-25T15:00:00Z',
    ]);

    const callArg = (MockPauboxApiClient.prototype.scheduleEmail as jest.Mock).mock.calls[0][0];
    expect(callArg.from).toBe('default@example.com');
    expect(callArg.scheduledAt).toBe('2025-12-25T15:00:00Z');
  });
});

describe('paubox schedule status', () => {
  it('displays scheduled message status', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'key' });
    MockPauboxApiClient.prototype.getScheduledMessage = jest.fn().mockResolvedValue({
      sourceTrackingId: 'sched-123',
      scheduledAt: '2025-12-25T15:00:00Z',
      state: 'pending',
    });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'schedule', 'status', 'sched-123',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('pending');
    expect(output).toContain('sched-123');
    writeSpy.mockRestore();
  });
});

describe('paubox schedule reschedule', () => {
  it('reschedules and prints new time', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'key' });
    MockPauboxApiClient.prototype.rescheduleMessage = jest.fn().mockResolvedValue({
      sourceTrackingId: 'sched-123',
      scheduledAt: '2025-12-26T10:00:00Z',
      state: 'pending',
    });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'schedule', 'reschedule', 'sched-123',
      '--at', '2025-12-26T10:00:00Z',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('2025-12-26T10:00:00Z');
    expect(output).toContain('sched-123');
    writeSpy.mockRestore();
  });
});

describe('paubox schedule cancel', () => {
  it('cancels scheduled email', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'key' });
    MockPauboxApiClient.prototype.cancelScheduledMessage = jest.fn().mockResolvedValue({
      sourceTrackingId: 'sched-123',
      state: 'cancelled',
    });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'schedule', 'cancel', 'sched-123',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('cancelled');
    expect(output).toContain('sched-123');
    writeSpy.mockRestore();
  });
});
