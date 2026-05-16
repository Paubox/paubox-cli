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
