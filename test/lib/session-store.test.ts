import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UserSession } from '../../src/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-session-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

type CredsModule = typeof import('../../src/lib/credentials');
type StoreModule = typeof import('../../src/lib/config-store');

const SESSION: UserSession = {
  token: 'session.jwt.token',
  environment: 'staging',
  webUrl: 'https://next.staging.paubox.net',
  iamUrl: 'https://api.staging.paubox.net/iam',
  email: 'jerry@paubox.com',
  userId: 7,
  customerId: 25,
  customerName: 'Paubox',
  expiresAt: '2026-12-12T00:00:00.000Z',
  createdAt: '2026-11-27T00:00:00.000Z',
};

async function withStores(
  keytarFactory: (() => unknown) | null,
  callback: (creds: CredsModule, store: StoreModule) => Promise<void>,
): Promise<void> {
  return jest.isolateModulesAsync(async () => {
    if (keytarFactory === null) {
      jest.mock('keytar', () => { throw new Error('keytar not available'); }, { virtual: true });
    } else {
      jest.mock('keytar', keytarFactory, { virtual: true });
    }
    const store = await import('../../src/lib/config-store');
    store.setConfigDir(tmpDir);
    const creds = await import('../../src/lib/credentials');
    await callback(creds, store);
  });
}

function memoryKeytar() {
  const entries = new Map<string, string>();
  return () => ({
    setPassword: jest.fn(async (service: string, account: string, value: string) => {
      entries.set(`${service}/${account}`, value);
    }),
    getPassword: jest.fn(async (service: string, account: string) => entries.get(`${service}/${account}`) ?? null),
    deletePassword: jest.fn(async (service: string, account: string) => entries.delete(`${service}/${account}`)),
  });
}

describe('session storage without a keychain', () => {
  it('round-trips the session through the config file', async () => {
    await withStores(null, async (creds) => {
      expect(await creds.saveSession(SESSION)).toEqual({ source: 'file' });
      expect(await creds.loadSession()).toEqual({ session: SESSION, source: 'file' });
    });
  });

  it('keeps the session and the API keys independent', async () => {
    await withStores(null, async (creds) => {
      await creds.saveSession(SESSION);
      await creds.saveCredentials({ apiKey: 'key' });
      await creds.clearCredentials();
      expect(await creds.loadSession()).toEqual({ session: SESSION, source: 'file' });

      await creds.saveCredentials({ apiKey: 'key' });
      await creds.clearSession();
      expect(await creds.loadSession()).toBeNull();
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'key' });
    });
  });
});

describe('session storage with a keychain', () => {
  it('stores the session under its own keychain entry', async () => {
    await withStores(memoryKeytar(), async (creds, store) => {
      expect(await creds.saveSession(SESSION)).toEqual({ source: 'keychain' });
      expect(await creds.loadSession()).toEqual({ session: SESSION, source: 'keychain' });
      expect(store.getSession()).toBeNull();
    });
  });

  it('falls back to the file when the keychain refuses, and says why', async () => {
    const refusing = () => ({
      setPassword: jest.fn().mockRejectedValue(new Error('Cannot autolaunch D-Bus without X11 $DISPLAY')),
      getPassword: jest.fn().mockRejectedValue(new Error('Cannot autolaunch D-Bus without X11 $DISPLAY')),
      deletePassword: jest.fn().mockRejectedValue(new Error('Cannot autolaunch D-Bus without X11 $DISPLAY')),
    });
    await withStores(refusing, async (creds) => {
      const saved = await creds.saveSession(SESSION);
      expect(saved.source).toBe('file');
      expect(saved.keychainError).toContain('D-Bus');
      expect(await creds.loadSession()).toEqual({ session: SESSION, source: 'file' });
      await creds.clearSession();
      expect(await creds.loadSession()).toBeNull();
    });
  });

  it('removes a stale file copy once the keychain accepts the session', async () => {
    await withStores(memoryKeytar(), async (creds, store) => {
      store.saveSession({ ...SESSION, token: 'old' });
      await creds.saveSession(SESSION);
      expect(store.getSession()).toBeNull();
      expect((await creds.loadSession())?.session.token).toBe('session.jwt.token');
    });
  });
});
