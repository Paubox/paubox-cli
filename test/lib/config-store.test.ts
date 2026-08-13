import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as configStore from '../../src/lib/config-store';

const itUnix = process.platform === 'win32' ? it.skip : it;

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
      configStore.saveCredentials({ apiKey: 'mykey' });
      const creds = configStore.getCredentials();
      expect(creds).toEqual({ apiKey: 'mykey' });
    });

    it('returns null when no credentials stored', () => {
      expect(configStore.getCredentials()).toBeNull();
    });

    it('clears credentials', () => {
      configStore.saveCredentials({ apiKey: 'mykey' });
      configStore.clearCredentials();
      expect(configStore.getCredentials()).toBeNull();
    });

    it('saves and loads a full credentials object with formsApiKey', () => {
      configStore.saveCredentials({
        apiKey: 'mykey',
        formsApiKey: 'myformskey',
      });
      expect(configStore.getCredentials()).toEqual({
        apiKey: 'mykey',
        formsApiKey: 'myformskey',
      });
    });

    it('saves a credentials object without formsApiKey', () => {
      configStore.saveCredentials({ apiKey: 'mykey' });
      const creds = configStore.getCredentials();
      expect(creds).toEqual({ apiKey: 'mykey' });
      expect(creds?.formsApiKey).toBeUndefined();
    });

    it('loads an old stored file without formsApiKey (back-compat)', () => {
      fs.writeFileSync(
        configStore.getConfigPath(),
        JSON.stringify({ credentials: { apiUsername: 'olduser', apiKey: 'oldkey' } }),
      );
      const creds = configStore.getCredentials();
      expect(creds).toEqual(expect.objectContaining({ apiKey: 'oldkey' }));
      expect(creds?.formsApiKey).toBeUndefined();
    });

    it('loads an old stored file with apiUsername and formsApiKey (back-compat)', () => {
      fs.writeFileSync(
        configStore.getConfigPath(),
        JSON.stringify({
          credentials: { apiUsername: 'olduser', apiKey: 'oldkey', formsApiKey: 'oldformskey' },
        }),
      );
      const creds = configStore.getCredentials();
      expect(creds).toEqual(
        expect.objectContaining({ apiKey: 'oldkey', formsApiKey: 'oldformskey' }),
      );
    });

    itUnix('sets file permissions to 0o600 with formsApiKey present (POSIX only)', () => {
      configStore.saveCredentials({
        apiKey: 'mykey',
        formsApiKey: 'myformskey',
      });
      const stat = fs.statSync(configStore.getConfigPath());
      expect(stat.mode & 0o777).toBe(0o600);
    });

    itUnix('sets file permissions to 0o600 (POSIX only)', () => {
      configStore.saveCredentials({ apiKey: 'mykey' });
      const stat = fs.statSync(configStore.getConfigPath());
      // On Linux, mode includes file type bits; mask to permission bits only.
      // Windows ignores POSIX permission bits entirely (fs.statSync returns 0o666
      // regardless of the mode passed to writeFileSync), so this assertion is
      // meaningful only on Unix-like systems.
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
      configStore.saveCredentials({ apiKey: 'mykey' });
      configStore.setConfigValue('defaultFrom', 'me@example.com');
      configStore.resetConfig();
      expect(configStore.listConfig()).toEqual({});
      expect(configStore.getCredentials()).toEqual({ apiKey: 'mykey' });
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
