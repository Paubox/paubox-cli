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

  it('treats empty-string email creds with no forms key as not authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: '', apiKey: '' });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({ authenticated: false, formsApiKey: null });
    writeSpy.mockRestore();
  });

  it('shows apiUsername when authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: 'myuser', apiKey: 'sekret' });
    mockCredentials.maskApiKey.mockReturnValue('****ret');
    mockCredentials.usingKeychain.mockReturnValue(false);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('myuser');
    writeSpy.mockRestore();
  });

  it('outputs JSON with --json flag', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: 'myuser', apiKey: 'sekret' });
    mockCredentials.maskApiKey.mockReturnValue('****ret');
    mockCredentials.usingKeychain.mockReturnValue(true);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.authenticated).toBe(true);
    expect(parsed.apiUsername).toBe('myuser');
    writeSpy.mockRestore();
  });

  it('JSON reports formsApiKey null when email-authenticated without a forms key', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: 'myuser', apiKey: 'sekret' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'auth', 'status']);

    const parsed = JSON.parse(writeSpy.mock.calls.map((c) => c[0]).join(''));
    expect(parsed).toEqual({
      authenticated: true,
      apiUsername: 'myuser',
      apiKey: '****kret',
      formsApiKey: null,
      storage: 'OS keychain',
    });
    writeSpy.mockRestore();
  });

  it('JSON includes masked formsApiKey when email-authenticated with a forms key', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({
      apiUsername: 'myuser',
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
      apiUsername: 'myuser',
      apiKey: '****kret',
      formsApiKey: '****9876',
      storage: 'config file',
    });
    writeSpy.mockRestore();
  });

  it('human output shows the forms key line when set', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({
      apiUsername: 'myuser',
      apiKey: 'sekret',
      formsApiKey: 'forms-key-9876',
    });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Authenticated as myuser');
    expect(output).toContain('Forms API key: ****9876');
    writeSpy.mockRestore();
  });

  it('human output suggests set-forms-key when authenticated without a forms key', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: 'myuser', apiKey: 'sekret' });
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'status']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Forms API key: not set');
    expect(output).toContain('paubox auth set-forms-key');
    writeSpy.mockRestore();
  });

  it('reports forms-only credentials (empty email fields) as not email-authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({
      apiUsername: '',
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
      apiUsername: '',
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
  it('saves the forms key standalone with empty email fields when no creds exist', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('forms-key-9876');
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(false);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'set-forms-key']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiUsername: '',
      apiKey: '',
      formsApiKey: 'forms-key-9876',
    });
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Forms API key saved');
    expect(output).toContain('****9876');
    expect(output).toContain('config file');
    writeSpy.mockRestore();
  });

  it('preserves existing email credentials when saving the forms key', async () => {
    const { password } = await import('@inquirer/prompts');
    (password as jest.Mock).mockResolvedValue('forms-key-9876');
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: 'myuser', apiKey: 'sekret' });
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.maskApiKey.mockImplementation((k: string) => '****' + k.slice(-4));
    mockCredentials.usingKeychain.mockReturnValue(true);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'set-forms-key']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiUsername: 'myuser',
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
      apiUsername: '',
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
  it('preserves an existing formsApiKey when re-logging in', async () => {
    const { input, password } = await import('@inquirer/prompts');
    (input as jest.Mock).mockResolvedValue('myuser');
    (password as jest.Mock).mockResolvedValue('new-sekret');
    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(true);
    mockCredentials.loadCredentials.mockResolvedValue({
      apiUsername: 'olduser',
      apiKey: 'old-sekret',
      formsApiKey: 'forms-key-9876',
    });
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.usingKeychain.mockReturnValue(false);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'login']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiUsername: 'myuser',
      apiKey: 'new-sekret',
      formsApiKey: 'forms-key-9876',
    });
    writeSpy.mockRestore();
  });

  it('saves only email credentials when no prior credentials exist', async () => {
    const { input, password } = await import('@inquirer/prompts');
    (input as jest.Mock).mockResolvedValue('myuser');
    (password as jest.Mock).mockResolvedValue('sekret');
    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(true);
    mockCredentials.loadCredentials.mockResolvedValue(null);
    mockCredentials.saveCredentials.mockResolvedValue();
    mockCredentials.usingKeychain.mockReturnValue(false);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'auth', 'login']);

    expect(mockCredentials.saveCredentials).toHaveBeenCalledWith({
      apiUsername: 'myuser',
      apiKey: 'sekret',
    });
    writeSpy.mockRestore();
  });

  it('throws AuthError on invalid credentials', async () => {
    const { input, password } = await import('@inquirer/prompts');
    (input as jest.Mock).mockResolvedValue('baduser');
    (password as jest.Mock).mockResolvedValue('badkey');

    MockPauboxApiClient.prototype.validateCredentials = jest.fn().mockResolvedValue(false);

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'auth', 'login']),
    ).rejects.toThrow();
  });
});
