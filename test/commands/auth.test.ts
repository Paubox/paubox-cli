import { createProgram } from '../../src/index';
import * as credentials from '../../src/lib/credentials';
import { PauboxApiClient } from '../../src/lib/api';

jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/api');
jest.mock('@inquirer/prompts');

const mockCredentials = credentials as jest.Mocked<typeof credentials>;
const MockPauboxApiClient = PauboxApiClient as jest.MockedClass<typeof PauboxApiClient>;

beforeEach(() => {
  jest.clearAllMocks();
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
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      authenticated: true,
      apiKey: '****kret',
      formsApiKey: '****9876',
      storage: 'config file',
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
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      authenticated: true,
      apiKey: '****kret',
      formsApiKey: '****9876',
      storage: 'config file',
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
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
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
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
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
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
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
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
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
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
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
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
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
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
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
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
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
});
