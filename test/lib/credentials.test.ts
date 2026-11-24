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
      await creds.saveCredentials({ apiKey: 'testkey123' });
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'testkey123' });
    });
  });

  it('returns null when nothing stored', async () => {
    await withCreds(null, async (creds) => {
      expect(await creds.loadCredentials()).toBeNull();
    });
  });

  it('clears credentials', async () => {
    await withCreds(null, async (creds) => {
      await creds.saveCredentials({ apiKey: 'testkey123' });
      await creds.clearCredentials();
      expect(await creds.loadCredentials()).toBeNull();
    });
  });

  it('reports not using keychain', async () => {
    await withCreds(null, async (creds) => {
      expect(creds.usingKeychain()).toBe(false);
    });
  });

  it('round-trips formsApiKey via config file', async () => {
    await withCreds(null, async (creds) => {
      await creds.saveCredentials({
        apiKey: 'testkey123',
        formsApiKey: 'formskey456',
      });
      expect(await creds.loadCredentials()).toEqual({
        apiKey: 'testkey123',
        formsApiKey: 'formskey456',
      });
    });
  });

  it('round-trips forms-only credentials (empty apiKey) via config file', async () => {
    await withCreds(null, async (creds) => {
      await creds.saveCredentials({ apiKey: '', formsApiKey: 'formskey456' });
      expect(await creds.loadCredentials()).toEqual({
        apiKey: '',
        formsApiKey: 'formskey456',
      });
    });
  });

  it('loads an old stored blob containing apiUsername (back-compat)', async () => {
    await withCreds(null, async (creds) => {
      fs.writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify({ credentials: { apiUsername: 'olduser', apiKey: 'oldkey' } }),
      );
      const loaded = await creds.loadCredentials();
      expect(loaded).toEqual(expect.objectContaining({ apiKey: 'oldkey' }));
      expect(loaded?.formsApiKey).toBeUndefined();
    });
  });

  it('loads an old stored blob with apiUsername and formsApiKey (back-compat)', async () => {
    await withCreds(null, async (creds) => {
      fs.writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify({
          credentials: { apiUsername: 'olduser', apiKey: 'oldkey', formsApiKey: 'oldformskey' },
        }),
      );
      const loaded = await creds.loadCredentials();
      expect(loaded).toEqual(
        expect.objectContaining({ apiKey: 'oldkey', formsApiKey: 'oldformskey' }),
      );
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
      await creds.saveCredentials({ apiKey: 'k' });
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'paubox-cli',
        'default',
        JSON.stringify({ apiKey: 'k' }),
      );
    });
  });

  it('loads from keychain', async () => {
    const mockKeytar = {
      setPassword: jest.fn(),
      getPassword: jest.fn().mockResolvedValue(JSON.stringify({ apiKey: 'k' })),
      deletePassword: jest.fn(),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'k' });
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

  it('serializes formsApiKey into the keychain blob', async () => {
    const mockKeytar = {
      setPassword: jest.fn().mockResolvedValue(undefined),
      getPassword: jest.fn().mockResolvedValue(null),
      deletePassword: jest.fn().mockResolvedValue(true),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      await creds.saveCredentials({ apiKey: 'k', formsApiKey: 'fk' });
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'paubox-cli',
        'default',
        JSON.stringify({ apiKey: 'k', formsApiKey: 'fk' }),
      );
    });
  });

  it('loads formsApiKey from the keychain blob', async () => {
    const mockKeytar = {
      setPassword: jest.fn(),
      getPassword: jest
        .fn()
        .mockResolvedValue(JSON.stringify({ apiKey: 'k', formsApiKey: 'fk' })),
      deletePassword: jest.fn(),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      expect(await creds.loadCredentials()).toEqual({
        apiKey: 'k',
        formsApiKey: 'fk',
      });
    });
  });

  it('loads an old keychain blob containing apiUsername (back-compat)', async () => {
    const mockKeytar = {
      setPassword: jest.fn(),
      getPassword: jest
        .fn()
        .mockResolvedValue(JSON.stringify({ apiUsername: 'u', apiKey: 'k', formsApiKey: 'fk' })),
      deletePassword: jest.fn(),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      const loaded = await creds.loadCredentials();
      expect(loaded).toEqual(expect.objectContaining({ apiKey: 'k', formsApiKey: 'fk' }));
    });
  });

  it('loads an old keychain blob without formsApiKey (back-compat)', async () => {
    const mockKeytar = {
      setPassword: jest.fn(),
      getPassword: jest
        .fn()
        .mockResolvedValue(JSON.stringify({ apiUsername: 'u', apiKey: 'k' })),
      deletePassword: jest.fn(),
    };
    await withCreds(() => mockKeytar, async (creds) => {
      const loaded = await creds.loadCredentials();
      expect(loaded).toEqual(expect.objectContaining({ apiKey: 'k' }));
      expect(loaded?.formsApiKey).toBeUndefined();
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

// keytar installs cleanly in a Linux container and then fails when it reaches
// for a session bus. loadKeytar()'s try/catch only ever covered keytar being
// absent, so this error escaped and took down every command — including the
// ones whose credentials were sitting in the config file all along.
const DBUS = 'Cannot autolaunch D-Bus without X11 $DISPLAY';

const throwingKeytar = () => ({
  getPassword: jest.fn(async () => { throw new Error(DBUS); }),
  setPassword: jest.fn(async () => { throw new Error(DBUS); }),
  deletePassword: jest.fn(async () => { throw new Error(DBUS); }),
});

describe('credentials (keytar present but throwing → headless)', () => {
  it('does not throw, and falls back to the config file', async () => {
    await withCreds(throwingKeytar, async (creds) => {
      const cs = await import('../../src/lib/config-store');
      cs.saveCredentials({ apiKey: 'file-key-1234' });

      const loaded = await creds.loadCredentials();

      expect(loaded).toEqual({ apiKey: 'file-key-1234' });
      expect(creds.credentialSource()).toBe('file');
      expect(creds.keychainError()).toContain('D-Bus');
    });
  });

  it('returns null rather than throwing when nothing is stored anywhere', async () => {
    await withCreds(throwingKeytar, async (creds) => {
      await expect(creds.loadCredentials()).resolves.toBeNull();
    });
  });

  // Without this there is no way to authenticate at all on a headless box:
  // the config file the user would be told to use is only writable here.
  it('saves to the config file and reports the downgrade', async () => {
    await withCreds(throwingKeytar, async (creds) => {
      const result = await creds.saveCredentials({ apiKey: 'written-5678' });

      expect(result.source).toBe('file');
      expect(result.keychainError).toContain('D-Bus');

      const cs = await import('../../src/lib/config-store');
      expect(cs.getCredentials()).toEqual({ apiKey: 'written-5678' });
    });
  });

  it('clears the file copy even though the keychain is unreachable', async () => {
    await withCreds(throwingKeytar, async (creds) => {
      const cs = await import('../../src/lib/config-store');
      cs.saveCredentials({ apiKey: 'to-be-cleared' });

      await expect(creds.clearCredentials()).resolves.toBeUndefined();
      expect(cs.getCredentials()).toBeNull();
    });
  });
});

// A working keychain that simply has no entry is not a reason to ignore the
// config file — a fallback write may have put the credential there.
describe('credentials (keychain reachable but empty)', () => {
  it('falls through to the config file', async () => {
    await withCreds(
      () => ({
        getPassword: jest.fn(async () => null),
        setPassword: jest.fn(async () => undefined),
        deletePassword: jest.fn(async () => true),
      }),
      async (creds) => {
        const cs = await import('../../src/lib/config-store');
        cs.saveCredentials({ apiKey: 'left-in-file' });

        expect(await creds.loadCredentials()).toEqual({ apiKey: 'left-in-file' });
        expect(creds.credentialSource()).toBe('file');
      },
    );
  });
});

describe('credentials (environment)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads PAUBOX_API_KEY without touching the keychain', async () => {
    await withCreds(throwingKeytar, async (creds) => {
      process.env.PAUBOX_API_KEY = 'env-key-0001';

      expect(await creds.loadCredentials()).toEqual({ apiKey: 'env-key-0001' });
      expect(creds.credentialSource()).toBe('environment');
    });
  });

  it('reads PAUBOX_FORMS_API_KEY', async () => {
    await withCreds(throwingKeytar, async (creds) => {
      process.env.PAUBOX_FORMS_API_KEY = 'env-forms-0002';

      const loaded = await creds.loadCredentials();
      expect(loaded?.formsApiKey).toBe('env-forms-0002');
    });
  });

  it('outranks a stored value', async () => {
    await withCreds(
      () => ({
        getPassword: jest.fn(async () => JSON.stringify({ apiKey: 'stored' })),
        setPassword: jest.fn(async () => undefined),
        deletePassword: jest.fn(async () => true),
      }),
      async (creds) => {
        process.env.PAUBOX_API_KEY = 'from-env';
        expect((await creds.loadCredentials())?.apiKey).toBe('from-env');
      },
    );
  });

  // Overlaid per field, so one key from the environment and the other from the
  // keychain is a working combination.
  it('overlays only the key that is set', async () => {
    await withCreds(
      () => ({
        getPassword: jest.fn(async () =>
          JSON.stringify({ apiKey: 'stored-email', formsApiKey: 'stored-forms' }),
        ),
        setPassword: jest.fn(async () => undefined),
        deletePassword: jest.fn(async () => true),
      }),
      async (creds) => {
        process.env.PAUBOX_FORMS_API_KEY = 'env-forms';

        expect(await creds.loadCredentials()).toEqual({
          apiKey: 'stored-email',
          formsApiKey: 'env-forms',
        });
      },
    );
  });

  it('ignores blank and whitespace-only values', async () => {
    await withCreds(throwingKeytar, async (creds) => {
      process.env.PAUBOX_API_KEY = '   ';
      expect(await creds.loadCredentials()).toBeNull();
    });
  });
});
