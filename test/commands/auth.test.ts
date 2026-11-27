import { createProgram } from '../../src/index';
import * as credentials from '../../src/lib/credentials';
import { PauboxApiClient } from '../../src/lib/api';
import { browserLogin } from '../../src/lib/browser-login';
import { AuthError, NetworkError } from '../../src/lib/errors';
import { IamClient } from '../../src/lib/iam-api';
import type { UserSession } from '../../src/types';

jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/api');
jest.mock('../../src/lib/browser-login');
jest.mock('../../src/lib/iam-api');
jest.mock('@inquirer/prompts');

const mockCredentials = credentials as jest.Mocked<typeof credentials>;
const MockPauboxApiClient = PauboxApiClient as jest.MockedClass<typeof PauboxApiClient>;
const mockBrowserLogin = browserLogin as jest.MockedFunction<typeof browserLogin>;
const MockIamClient = IamClient as jest.MockedClass<typeof IamClient>;

const FUTURE = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function session(overrides: Partial<UserSession> = {}): UserSession {
  return {
    token: 'session.jwt.token',
    environment: 'staging',
    webUrl: 'https://next.staging.paubox.net',
    iamUrl: 'https://api.staging.paubox.net/iam',
    email: 'jerry@paubox.com',
    userId: 7,
    customerId: 25,
    customerName: 'Paubox',
    expiresAt: FUTURE,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const ENTITLEMENTS = {
  id: 7,
  name: 'Jerry',
  email: 'jerry@paubox.com',
  customer_id: 25,
  customer: 'Paubox',
  roles: ['admin'],
  mfa_verified: true,
};

function captureStdout() {
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return {
    text: () => spy.mock.calls.map((c) => c[0]).join(''),
    restore: () => spy.mockRestore(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Null per key by default, so these tests keep exercising the overall
  // source they already set via credentialSource().
  mockCredentials.credentialSources.mockReturnValue({ apiKey: null, formsApiKey: null });
});

describe('paubox auth status', () => {
  it('reports not authenticated when no creds', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(null);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Not authenticated');
    writeSpy.mockRestore();
  });

  it('outputs { authenticated: false, formsApiKey: null } JSON when no creds', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(null);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({ authenticated: false, formsApiKey: null });
    writeSpy.mockRestore();
  });

  it('treats an empty-string apiKey with no forms key as not authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: '' });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({ authenticated: false, formsApiKey: null });
    writeSpy.mockRestore();
  });

  it('shows the masked API key when authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'sekret' });
    mockCredentials.maskApiKey.mockReturnValue('****ret');
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Authenticated');
    expect(output).toContain('****ret');
    writeSpy.mockRestore();
  });

  it('outputs JSON with --json flag', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'sekret' });
    mockCredentials.maskApiKey.mockReturnValue('****ret');
    mockCredentials.usingKeychain.mockReturnValue(true);
    mockCredentials.credentialSource.mockReturnValue('keychain');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.authenticated).toBe(true);
    expect(parsed).not.toHaveProperty('apiUsername');
    writeSpy.mockRestore();
  });

  it('JSON reports formsApiKey null when email-authenticated without a forms key', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'sekret' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
    mockCredentials.credentialSource.mockReturnValue('keychain');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      authenticated: true,
      apiKey: '****kret',
      formsApiKey: null,
      storage: 'OS keychain',
    });
    writeSpy.mockRestore();
  });

  it('JSON includes masked formsApiKey when email-authenticated with a forms key', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({
      apiKey: 'sekret',
      formsApiKey: 'forms-key-9876',
    });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      authenticated: true,
      apiKey: '****kret',
      formsApiKey: '****9876',
      storage: 'config file',
      // Reported separately: the two keys can come from different stores.
      formsStorage: 'config file',
    });
    writeSpy.mockRestore();
  });

  it('ignores a leftover apiUsername field from an old stored blob', async () => {
    // Back-compat: blobs saved by older versions may still carry apiUsername.
    mockCredentials.loadCredentials.mockResolvedValue({
      apiUsername: 'olduser',
      apiKey: 'sekret',
      formsApiKey: 'forms-key-9876',
    } as never);
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      authenticated: true,
      apiKey: '****kret',
      formsApiKey: '****9876',
      storage: 'config file',
      // Reported separately: the two keys can come from different stores.
      formsStorage: 'config file',
    });
    expect(parsed).not.toHaveProperty('apiUsername');
    writeSpy.mockRestore();
  });

  it('human output shows the forms key line when set', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({
      apiKey: 'sekret',
      formsApiKey: 'forms-key-9876',
    });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Authenticated');
    expect(output).toContain('Forms API key: ****9876');
    writeSpy.mockRestore();
  });

  it('human output suggests set-forms-key when authenticated without a forms key', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'sekret' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Forms API key: not set');
    expect(output).toContain('paubox auth set-forms-key');
    writeSpy.mockRestore();
  });

  it('reports forms-only credentials (empty apiKey) as not email-authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({
      apiKey: '',
      formsApiKey: 'forms-key-9876',
    });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Email API: not authenticated');
    expect(output).toContain('paubox auth login');
    expect(output).toContain('Forms API key: ****9876');
    writeSpy.mockRestore();
  });

  it('outputs forms-only JSON shape with authenticated false', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({
      apiKey: '',
      formsApiKey: 'forms-key-9876',
    });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
    mockCredentials.credentialSource.mockReturnValue('keychain');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      authenticated: false,
      formsApiKey: '****9876',
      storage: 'OS keychain',
    });
    writeSpy.mockRestore();
  });
});

describe('paubox auth set-forms-key', () => {
  it('saves the forms key standalone with an empty apiKey when no creds exist', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('forms-key-9876');
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'file' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'set-forms-key']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiKey: '',
      formsApiKey: 'forms-key-9876',
    });
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Forms API key saved');
    expect(output).toContain('****9876');
    expect(output).toContain('config file');
    writeSpy.mockRestore();
  });

  it('preserves the existing apiKey when saving the forms key', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('forms-key-9876');
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'sekret' });
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'keychain' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
    mockCredentials.credentialSource.mockReturnValue('keychain');
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'set-forms-key']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiKey: 'sekret',
      formsApiKey: 'forms-key-9876',
    });
  });

  it('trims whitespace from the entered key', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('  forms-key-9876  ');
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'file' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'set-forms-key']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiKey: '',
      formsApiKey: 'forms-key-9876',
    });
  });

  it('rejects with AuthError when the key is empty', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('   ');

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'auth', 'set-forms-key']),
    ).rejects.toThrow('Forms API key is required.');
    expect(mockCredentials.saveCredentials).not.toHaveBeenCalled();
  });

  it('outputs JSON shape with --json flag', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('forms-key-9876');
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'keychain' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
    mockCredentials.credentialSource.mockReturnValue('keychain');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'set-forms-key']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      status: 'ok',
      formsApiKey: '****9876',
      storage: 'OS keychain',
    });
    writeSpy.mockRestore();
  });
});

describe('paubox auth logout', () => {
  it('clears credentials', async () => {
    mockCredentials.clearCredentials.mockResolvedValue();
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'logout']);

    expect(mockCredentials.clearCredentials).toHaveBeenCalledTimes(1);
  });
});

describe('paubox auth login', () => {
  it('preserves an existing formsApiKey on re-login', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('new-sekret');
    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(true);
    mockCredentials.loadCredentials.mockResolvedValue({
      apiKey: 'old-sekret',
      formsApiKey: 'forms-key-9876',
    });
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'file' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'login']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiKey: 'new-sekret',
      formsApiKey: 'forms-key-9876',
    });
    writeSpy.mockRestore();
  });

  it('saves only the apiKey when no prior credentials exist', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('sekret');
    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(true);
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'file' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'login']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiKey: 'sekret',
    });
    writeSpy.mockRestore();
  });

  it('prints the masked key and storage location on success', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('sekret');
    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(true);
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'file' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    mockCredentials.credentialSource.mockReturnValue('file');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'login']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Authenticated (API key: ****kret, stored in config file)');
    writeSpy.mockRestore();
  });

  it('outputs { status, apiKey, storage } JSON with --json flag', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('sekret');
    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(true);
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'keychain' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
    mockCredentials.credentialSource.mockReturnValue('keychain');
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'login']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      status: 'ok',
      apiKey: '****kret',
      storage: 'OS keychain',
    });
    writeSpy.mockRestore();
  });

  it('rejects with AuthError when the key is empty', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('   ');

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'auth', 'login']),
    ).rejects.toThrow('API key is required.');
    expect(mockCredentials.saveCredentials).not.toHaveBeenCalled();
  });

  it('throws AuthError on invalid credentials', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('badkey');

    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(false);

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'auth', 'login']),
    ).rejects.toThrow();
  });

  it('uses the API key prompt for --api-key', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('sekret');
    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(true);
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue({ source: 'file' });
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'login', '--api-key']);

    expect(mockBrowserLogin).not.toHaveBeenCalled();
    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({ apiKey: 'sekret' });
    out.restore();
  });

  it('refuses --api-key combined with browser options', async () => {
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'auth', 'login', '--api-key', '--web']),
    ).rejects.toThrow('--api-key cannot be combined');
  });
});

describe('paubox auth login --web', () => {
  beforeEach(() => {
    mockBrowserLogin.mockResolvedValue({ token: 'session.jwt.token' });
    MockIamClient.prototype.getEntitlements = jest.fn().mockResolvedValue(ENTITLEMENTS);
    mockCredentials.saveSession.mockResolvedValue({ source: 'keychain' });
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('logs in through the browser and stores the session', async () => {
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'login', '--web']);

    expect(mockBrowserLogin).toHaveBeenCalledWith(
      expect.objectContaining({ webUrl: 'https://next.paubox.com', openBrowser: expect.any(Function) }),
    );
    expect(MockIamClient).toHaveBeenCalledWith('https://apx.paubox.com/iam', 'session.jwt.token');
    expect(mockCredentials.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'session.jwt.token',
        environment: 'production',
        email: 'jerry@paubox.com',
        userId: 7,
        customerId: 25,
        customerName: 'Paubox',
      }),
    );
    expect(out.text()).toContain('Logged in as jerry@paubox.com (Paubox)');
    expect(out.text()).toContain('OS keychain');
    out.restore();
  });

  it('logs in against a local dashboard and labels the session custom', async () => {
    const out = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'auth', 'login', '--env', 'staging', '--web-url', 'https://local.paubox.net',
    ]);

    expect(mockBrowserLogin).toHaveBeenCalledWith(expect.objectContaining({ webUrl: 'https://local.paubox.net' }));
    expect(MockIamClient).toHaveBeenCalledWith('https://api.staging.paubox.net/iam', 'session.jwt.token');
    expect(mockCredentials.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'custom', webUrl: 'https://local.paubox.net' }),
    );
    expect(out.text()).toContain('on local.paubox.net');
    out.restore();
  });

  it('does not launch a browser with --no-browser', async () => {
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'login', '--no-browser']);

    expect(mockBrowserLogin).toHaveBeenCalledWith(expect.objectContaining({ openBrowser: undefined }));
    out.restore();
  });

  it('refuses a session that has not completed MFA', async () => {
    MockIamClient.prototype.getEntitlements = jest.fn().mockResolvedValue({ ...ENTITLEMENTS, mfa_verified: false });

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'auth', 'login', '--web']),
    ).rejects.toThrow('MFA');
    expect(mockCredentials.saveSession).not.toHaveBeenCalled();
  });

  it('prints the session summary as JSON with --json', async () => {
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'login', '--web', '--env', 'staging']);

    expect(JSON.parse(out.text())).toEqual(
      expect.objectContaining({
        status: 'ok',
        email: 'jerry@paubox.com',
        customer: 'Paubox',
        customerId: 25,
        environment: 'staging',
        storage: 'OS keychain',
      }),
    );
    out.restore();
  });
});

describe('paubox auth status with a browser session', () => {
  beforeEach(() => {
    mockCredentials.credentialSource.mockReturnValue('keychain');
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('reports an active session alongside the API key in JSON', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session(), source: 'keychain' });
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'sekret' });
    MockIamClient.prototype.getEntitlements = jest.fn().mockResolvedValue(ENTITLEMENTS);
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    expect(JSON.parse(out.text())).toEqual({
      authenticated: true,
      apiKey: '****kret',
      formsApiKey: null,
      storage: 'OS keychain',
      session: {
        state: 'active',
        email: 'jerry@paubox.com',
        customer: 'Paubox',
        customerId: 25,
        environment: 'staging',
        expiresAt: FUTURE,
        storage: 'OS keychain',
      },
    });
    out.restore();
  });

  it('shows a session-only login without claiming the user is unauthenticated', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session(), source: 'file' });
    mockCredentials.loadCredentials.mockResolvedValue(null);
    MockIamClient.prototype.getEntitlements = jest.fn().mockResolvedValue(ENTITLEMENTS);
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    expect(out.text()).toContain('Logged in as jerry@paubox.com (Paubox) on staging');
    expect(out.text()).toContain('Email API key: not set');
    expect(out.text()).not.toContain('Not authenticated');
    out.restore();
  });

  it('reports an expired session without calling IAM', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session({ expiresAt: PAST }), source: 'keychain' });
    mockCredentials.loadCredentials.mockResolvedValue(null);
    MockIamClient.prototype.getEntitlements = jest.fn();
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    expect(JSON.parse(out.text()).session.state).toBe('expired');
    expect(MockIamClient.prototype.getEntitlements).not.toHaveBeenCalled();
    out.restore();
  });

  it('reports a session IAM rejects as revoked', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session(), source: 'keychain' });
    mockCredentials.loadCredentials.mockResolvedValue(null);
    MockIamClient.prototype.getEntitlements = jest.fn().mockRejectedValue(AuthError.invalid('account'));
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    expect(JSON.parse(out.text()).session.state).toBe('revoked');
    out.restore();
  });

  it('reports a session it could not reach IAM to check as unverified', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session(), source: 'keychain' });
    mockCredentials.loadCredentials.mockResolvedValue(null);
    MockIamClient.prototype.getEntitlements = jest.fn().mockRejectedValue(new NetworkError('offline'));
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    expect(JSON.parse(out.text()).session.state).toBe('unverified');
    out.restore();
  });
});

describe('paubox auth logout with a browser session', () => {
  it('revokes the session at IAM and clears both stores', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session(), source: 'keychain' });
    MockIamClient.prototype.signOut = jest.fn().mockResolvedValue(undefined);
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'logout']);

    expect(MockIamClient).toHaveBeenCalledWith('https://api.staging.paubox.net/iam', 'session.jwt.token');
    expect(MockIamClient.prototype.signOut).toHaveBeenCalledTimes(1);
    expect(mockCredentials.clearCredentials).toHaveBeenCalledTimes(1);
    expect(mockCredentials.clearSession).toHaveBeenCalledTimes(1);
    out.restore();
  });

  it('still clears local state and warns when IAM cannot be reached', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session(), source: 'keychain' });
    MockIamClient.prototype.signOut = jest.fn().mockRejectedValue(new NetworkError('offline'));
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'logout']);

    expect(mockCredentials.clearSession).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls.map((c) => c[0]).join('')).toContain('Could not revoke');
    out.restore();
    errSpy.mockRestore();
  });
});

describe('paubox auth token', () => {
  it('prints the bare session token', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session(), source: 'keychain' });
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'token']);

    expect(out.text()).toBe('session.jwt.token\n');
    out.restore();
  });

  it('prints the token and where to use it with --json', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session(), source: 'keychain' });
    const out = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'token']);

    expect(JSON.parse(out.text())).toEqual({
      token: 'session.jwt.token',
      email: 'jerry@paubox.com',
      customerId: 25,
      customer: 'Paubox',
      environment: 'staging',
      webUrl: 'https://next.staging.paubox.net',
      iamUrl: 'https://api.staging.paubox.net/iam',
      expiresAt: FUTURE,
    });
    out.restore();
  });

  it('fails with an auth error when not logged in', async () => {
    mockCredentials.loadSession.mockResolvedValue(null);

    await expect(createProgram().parseAsync(['node', 'paubox', 'auth', 'token'])).rejects.toBeInstanceOf(AuthError);
  });

  it('fails with an auth error when the session has expired', async () => {
    mockCredentials.loadSession.mockResolvedValue({ session: session({ expiresAt: PAST }), source: 'keychain' });

    await expect(createProgram().parseAsync(['node', 'paubox', 'auth', 'token'])).rejects.toThrow('expired');
  });
});
