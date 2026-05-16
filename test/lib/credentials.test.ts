import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-creds-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

type CredsModule = typeof import('../../src/lib/credentials');

async function withCreds(
  keytarFactory: (() => unknown) | null,
  callback: (creds: CredsModule) => Promise<void>,
): Promise<void> {
  return jest.isolateModulesAsync(async () => {
    if (keytarFactory === null) {
      jest.mock('keytar', () => { throw new Error('keytar not available'); }, { virtual: true });
    } else {
      jest.mock('keytar', keytarFactory, { virtual: true });
    }
    const cs = await import('../../src/lib/config-store');
    cs.setConfigDir(tmpDir);
    const creds = await import('../../src/lib/credentials');
    await callback(creds);
  });
}

describe('credentials (keytar unavailable → file fallback)', () => {
  it('saves and loads credentials via config file', async () => {
    await withCreds(null, async (creds) => {
      await creds.saveCredentials({ apiUsername: 'testuser', apiKey: 'testkey123' });
      expect(await creds.loadCredentials()).toEqual({ apiUsername: 'testuser', apiKey: 'testkey123' });
    });
  });

  it('returns null when nothing stored', async () => {
    await withCreds(null, async (creds) => {
      expect(await creds.loadCredentials()).toBeNull();
    });
  });

  it('clears credentials', async () => {
    await withCreds(null, async (creds) => {
      await creds.saveCredentials({ apiUsername: 'testuser', apiKey: 'testkey123' });
      await creds.clearCredentials();
      expect(await creds.loadCredentials()).toBeNull();
    });
  });

  it('reports not using keychain', async () => {
    await withCreds(null, async (creds) => {
      expect(creds.usingKeychain()).toBe(false);
    });
  });
});

describe('credentials (keytar available)', () => {
  it('saves to keychain', async () => {
    const mockKeytar = {
      setPassword: jest.fn().mockResolvedValue(undefined),
      getPassword: jest.fn().mockResolvedValue(null),
      deletePassword: jest.fn().mockResolvedValue(true),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      await creds.saveCredentials({ apiUsername: 'u', apiKey: 'k' });
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'paubox-cli',
        'default',
        JSON.stringify({ apiUsername: 'u', apiKey: 'k' }),
      );
    });
  });

  it('loads from keychain', async () => {
    const mockKeytar = {
      setPassword: jest.fn(),
      getPassword: jest.fn().mockResolvedValue(JSON.stringify({ apiUsername: 'u', apiKey: 'k' })),
      deletePassword: jest.fn(),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      expect(await creds.loadCredentials()).toEqual({ apiUsername: 'u', apiKey: 'k' });
    });
  });

  it('returns null when keychain has no entry', async () => {
    const mockKeytar = {
      setPassword: jest.fn(),
      getPassword: jest.fn().mockResolvedValue(null),
      deletePassword: jest.fn(),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      expect(await creds.loadCredentials()).toBeNull();
    });
  });

  it('deletes from keychain on clear', async () => {
    const mockKeytar = {
      setPassword: jest.fn(),
      getPassword: jest.fn(),
      deletePassword: jest.fn().mockResolvedValue(true),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      await creds.clearCredentials();
      expect(mockKeytar.deletePassword).toHaveBeenCalledWith('paubox-cli', 'default');
    });
  });

  it('reports using keychain', async () => {
    const mockKeytar = {
      setPassword: jest.fn(),
      getPassword: jest.fn(),
      deletePassword: jest.fn(),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      expect(creds.usingKeychain()).toBe(true);
    });
  });
});

describe('maskApiKey', () => {
  it('masks all but last 4 chars', () => {
    const { maskApiKey } = jest.requireActual('../../src/lib/credentials') as CredsModule;
    expect(maskApiKey('abcdefgh')).toBe('****efgh');
  });

  it('masks short keys entirely', () => {
    const { maskApiKey } = jest.requireActual('../../src/lib/credentials') as CredsModule;
    expect(maskApiKey('ab')).toBe('****');
  });
});
