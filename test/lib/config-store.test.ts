import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as configStore from '../../src/lib/config-store';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-test-'));
  configStore.setConfigDir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  configStore.setConfigDir('');
});

describe('config-store', () => {
  describe('credentials', () => {
    it('saves and loads credentials', () => {
      configStore.saveCredentials('myuser', 'mykey');
      const creds = configStore.getCredentials();
      expect(creds).toEqual({ apiUsername: 'myuser', apiKey: 'mykey' });
    });

    it('returns null when no credentials stored', () => {
      expect(configStore.getCredentials()).toBeNull();
    });

    it('clears credentials', () => {
      configStore.saveCredentials('myuser', 'mykey');
      configStore.clearCredentials();
      expect(configStore.getCredentials()).toBeNull();
    });

    it('sets file permissions to 0o600', () => {
      configStore.saveCredentials('myuser', 'mykey');
      const stat = fs.statSync(configStore.getConfigPath());
      // On Linux, mode includes file type bits; mask to permission bits only
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe('config values', () => {
    it('sets and gets a config value', () => {
      configStore.setConfigValue('defaultFrom', 'me@example.com');
      expect(configStore.getConfigValue('defaultFrom')).toBe('me@example.com');
    });

    it('returns undefined for unset key', () => {
      expect(configStore.getConfigValue('defaultFrom')).toBeUndefined();
    });

    it('lists all config values', () => {
      configStore.setConfigValue('defaultFrom', 'me@example.com');
      const all = configStore.listConfig();
      expect(all).toEqual({ defaultFrom: 'me@example.com' });
    });

    it('resets config without touching credentials', () => {
      configStore.saveCredentials('myuser', 'mykey');
      configStore.setConfigValue('defaultFrom', 'me@example.com');
      configStore.resetConfig();
      expect(configStore.listConfig()).toEqual({});
      expect(configStore.getCredentials()).toEqual({ apiUsername: 'myuser', apiKey: 'mykey' });
    });

    it('overwrites an existing config value', () => {
      configStore.setConfigValue('defaultFrom', 'a@example.com');
      configStore.setConfigValue('defaultFrom', 'b@example.com');
      expect(configStore.getConfigValue('defaultFrom')).toBe('b@example.com');
    });
  });

  describe('getConfigPath', () => {
    it('returns path inside the configured directory', () => {
      expect(configStore.getConfigPath()).toBe(path.join(tmpDir, 'config.json'));
    });
  });
});
