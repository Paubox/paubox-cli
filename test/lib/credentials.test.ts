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
  delete process.env.PAUBOX_API_KEY;
  delete process.env.PAUBOX_FORMS_API_KEY;
});

const DBUS_ERROR = 'Cannot autolaunch D-Bus without X11 $DISPLAY';

/** keytar as it behaves on a headless Linux box: installed, but every call throws. */
function brokenKeytar() {
  const fail = jest.fn().mockRejectedValue(new Error(DBUS_ERROR));
  return { setPassword: fail, getPassword: fail, deletePassword: fail };
}

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

describe('credentials (keytar installed but the keychain throws)', () => {
  it('saves to the config file instead of failing', async () => {
    const keytar = brokenKeytar();
    await withCreds(() => keytar, async (creds) => {
      await creds.saveCredentials({ apiKey: 'k' });
      const file = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
      expect(file.credentials).toEqual({ apiKey: 'k' });
      expect(creds.usingKeychain()).toBe(false);
      expect(creds.keychainUnavailableReason()).toBe(DBUS_ERROR);
    });
  });

  it('loads from the config file instead of failing', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ credentials: { apiKey: 'filekey' } }));
    await withCreds(() => brokenKeytar(), async (creds) => {
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'filekey' });
    });
  });

  it('returns null rather than throwing when nothing is stored anywhere', async () => {
    await withCreds(() => brokenKeytar(), async (creds) => {
      await expect(creds.loadCredentials()).resolves.toBeNull();
    });
  });

  it('stops calling the keychain after the first failure', async () => {
    const keytar = brokenKeytar();
    await withCreds(() => keytar, async (creds) => {
      await creds.loadCredentials();
      await creds.loadCredentials();
      expect(keytar.getPassword).toHaveBeenCalledTimes(1);
    });
  });

  it('clears the config file on logout', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ credentials: { apiKey: 'filekey' } }));
    await withCreds(() => brokenKeytar(), async (creds) => {
      await creds.clearCredentials();
      expect(await creds.loadCredentials()).toBeNull();
    });
  });

  it('reads the config file when the keychain works but is empty', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ credentials: { apiKey: 'filekey' } }));
    const keytar = { setPassword: jest.fn(), getPassword: jest.fn().mockResolvedValue(null), deletePassword: jest.fn() };
    await withCreds(() => keytar, async (creds) => {
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'filekey' });
    });
  });
});

describe('credentials from the environment', () => {
  it('uses PAUBOX_API_KEY over the stored key', async () => {
    process.env.PAUBOX_API_KEY = ' envkey ';
    await withCreds(null, async (creds) => {
      await creds.saveCredentials({ apiKey: 'stored', formsApiKey: 'storedforms' });
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'envkey', formsApiKey: 'storedforms' });
    });
  });

  it('works with no stored credentials at all', async () => {
    process.env.PAUBOX_API_KEY = 'envkey';
    await withCreds(() => brokenKeytar(), async (creds) => {
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'envkey' });
    });
  });

  it('does not touch the keychain when both keys are in the environment', async () => {
    process.env.PAUBOX_API_KEY = 'envkey';
    process.env.PAUBOX_FORMS_API_KEY = 'envforms';
    const keytar = brokenKeytar();
    await withCreds(() => keytar, async (creds) => {
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'envkey', formsApiKey: 'envforms' });
      expect(keytar.getPassword).not.toHaveBeenCalled();
    });
  });

  it('supplies only a forms key, leaving the stored email key in place', async () => {
    process.env.PAUBOX_FORMS_API_KEY = 'envforms';
    await withCreds(null, async (creds) => {
      await creds.saveCredentials({ apiKey: 'stored' });
      expect(await creds.loadCredentials()).toEqual({ apiKey: 'stored', formsApiKey: 'envforms' });
    });
  });

  it('ignores an empty variable', async () => {
    process.env.PAUBOX_API_KEY = '  ';
    await withCreds(null, async (creds) => {
      expect(await creds.loadCredentials()).toBeNull();
    });
  });

  it('keeps environment keys out of loadStoredCredentials', async () => {
    process.env.PAUBOX_API_KEY = 'envkey';
    await withCreds(null, async (creds) => {
      expect(await creds.loadStoredCredentials()).toBeNull();
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
