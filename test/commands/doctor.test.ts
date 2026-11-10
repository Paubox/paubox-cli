import { createProgram } from '../../src/index';
import * as credentials from '../../src/lib/credentials';
import { summarize } from '../../src/commands/doctor';
import { fakeResponse, transportFailure } from '../helpers/fake-response';

jest.mock('../../src/lib/credentials', () => ({
  ...jest.requireActual('../../src/lib/credentials'),
  loadCredentials: jest.fn(),
  usingKeychain: jest.fn(() => false),
}));

const mockCredentials = credentials as jest.Mocked<typeof credentials>;

interface CheckRow {
  name: string;
  status: string;
  detail: string;
}

let fetchSpy: jest.SpyInstance;
let stdout: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = undefined;
  stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  fetchSpy = jest.spyOn(global, 'fetch');
});

afterEach(() => {
  jest.restoreAllMocks();
  process.exitCode = undefined;
});

/** Answer each probe by URL substring. */
function answer(byUrl: Record<string, number | Error>): void {
  fetchSpy.mockImplementation(async (url: string) => {
    for (const [fragment, outcome] of Object.entries(byUrl)) {
      if (String(url).includes(fragment)) {
        if (outcome instanceof Error) throw outcome;
        return fakeResponse(outcome);
      }
    }
    throw new Error(`unexpected probe ${url}`);
  });
}

async function runDoctor(): Promise<Record<string, CheckRow>> {
  await createProgram().parseAsync(['node', 'paubox', '--json', 'doctor']);
  const written = stdout.mock.calls.map((c) => String(c[0])).join('');
  const { checks } = JSON.parse(written) as { checks: CheckRow[] };
  return Object.fromEntries(checks.map((check) => [check.name, check]));
}

function authHeaderFor(fragment: string): string | undefined {
  const call = fetchSpy.mock.calls.find(([url]) => String(url).includes(fragment));
  return (call?.[1] as RequestInit | undefined)?.headers
    ? ((call![1] as RequestInit).headers as Record<string, string>).Authorization
    : undefined;
}

describe('paubox doctor', () => {
  it('fails a probe whose stored key is rejected and sets a non-zero exit', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'bad-email', formsApiKey: 'bad-forms' });
    answer({ message_receipt: 401, '/api/forms': 401, '/endpoints': 401 });

    const checks = await runDoctor();

    expect(checks['Email API']).toMatchObject({ status: 'fail' });
    expect(checks['Email API'].detail).toContain('Email API key rejected');
    expect(checks['Forms API'].detail).toContain('Forms API key rejected');
    expect(process.exitCode).toBe(1);
  });

  it('sends each key in the format its API expects', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'ek', formsApiKey: 'fk' });
    answer({ message_receipt: 404, '/api/forms': 200, '/endpoints': 200 });

    await runDoctor();

    expect(authHeaderFor('message_receipt')).toBe('Token token=ek');
    expect(authHeaderFor('/api/forms')).toBe('Bearer fk');
    expect(authHeaderFor('/endpoints')).toBe('Bearer fk');
  });

  it('accepts a 404 on the probe path as a valid key and exits 0', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'ek', formsApiKey: 'fk' });
    answer({ message_receipt: 404, '/api/forms': 200, '/endpoints': 200 });

    const checks = await runDoctor();

    expect(checks['Email API']).toMatchObject({ status: 'ok' });
    expect(checks['Email API'].detail).toContain('accepted');
    expect(process.exitCode).toBeUndefined();
  });

  it('warns rather than fails when a key is valid but not scoped (403)', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'ek', formsApiKey: 'fk' });
    answer({ message_receipt: 404, '/api/forms': 403, '/endpoints': 200 });

    const checks = await runDoctor();

    expect(checks['Forms API']).toMatchObject({ status: 'warn' });
    expect(checks['Forms API'].detail).toContain('not scoped');
    expect(process.exitCode).toBeUndefined();
  });

  it('uses the Email API key as a Bearer token for webhooks when no Forms key is stored', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'ek' });
    answer({ message_receipt: 404, '/api/forms': 401, '/endpoints': 200 });

    const checks = await runDoctor();

    expect(authHeaderFor('/endpoints')).toBe('Bearer ek');
    expect(authHeaderFor('/api/forms')).toBeUndefined();
    expect(checks['Forms API']).toMatchObject({ status: 'warn' });
    expect(checks['Forms API'].detail).toContain('no key stored');
  });

  it('reports an unreachable API as a failure', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiKey: 'ek', formsApiKey: 'fk' });
    answer({
      message_receipt: transportFailure('ENOTFOUND', 'getaddrinfo ENOTFOUND api.paubox.com'),
      '/api/forms': 200,
      '/endpoints': 200,
    });

    const checks = await runDoctor();

    expect(checks['Email API']).toMatchObject({ status: 'fail' });
    expect(checks['Email API'].detail).toContain('unreachable');
    expect(process.exitCode).toBe(1);
  });
});

describe('summarize', () => {
  it('does not claim "no problems" when there are warnings', () => {
    expect(summarize([{ name: 'a', status: 'warn', detail: '' }])).toBe('No failures; 1 warning(s).');
  });

  it('counts failures and warnings together', () => {
    expect(
      summarize([
        { name: 'a', status: 'fail', detail: '' },
        { name: 'b', status: 'warn', detail: '' },
      ]),
    ).toBe('1 check(s) failed, 1 warning(s).');
  });

  it('reports a clean run', () => {
    expect(summarize([{ name: 'a', status: 'ok', detail: '' }])).toBe('No problems found.');
  });
});
