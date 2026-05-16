import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/index';
import * as configStore from '../../src/lib/config-store';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-config-cmd-'));
  configStore.setConfigDir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  configStore.setConfigDir('');
});

describe('paubox config set', () => {
  it('sets a valid key', async () => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await createProgram().parseAsync(['node', 'paubox', 'config', 'set', 'defaultFrom', 'me@example.com']);
    expect(configStore.getConfigValue('defaultFrom')).toBe('me@example.com');
  });

  it('throws ConfigError for unknown key', async () => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'config', 'set', 'unknownKey', 'value']),
    ).rejects.toThrow();
  });
});

describe('paubox config get', () => {
  it('prints the value', async () => {
    configStore.setConfigValue('defaultFrom', 'me@example.com');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'config', 'get', 'defaultFrom']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('me@example.com');
    writeSpy.mockRestore();
  });

  it('throws ConfigError for unset key', async () => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'config', 'get', 'defaultFrom']),
    ).rejects.toThrow();
  });
});

describe('paubox config list', () => {
  it('outputs JSON with --json flag', async () => {
    configStore.setConfigValue('defaultFrom', 'me@example.com');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'config', 'list']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.defaultFrom).toBe('me@example.com');
    writeSpy.mockRestore();
  });
});

describe('paubox config reset', () => {
  it('clears all config', async () => {
    configStore.setConfigValue('defaultFrom', 'me@example.com');
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'config', 'reset']);

    expect(configStore.listConfig()).toEqual({});
  });
});
