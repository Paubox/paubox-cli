import { confirm } from '@inquirer/prompts';
import { confirmDestructive } from '../../src/lib/confirm';
import { ConfigError } from '../../src/lib/errors';

jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn() }));

const mockConfirm = confirm as unknown as jest.Mock;

const originalIsTTY = process.stdin.isTTY;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: originalIsTTY,
    configurable: true,
  });
});

describe('confirmDestructive', () => {
  it('skips the prompt entirely when --yes was passed', async () => {
    setTTY(true);
    await expect(confirmDestructive('Delete everything?', true)).resolves.toBeUndefined();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('does not prompt in a non-interactive shell', async () => {
    setTTY(false);
    await expect(confirmDestructive('Delete everything?')).rejects.toThrow(ConfigError);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('points non-interactive callers at --yes', async () => {
    setTTY(false);
    await expect(confirmDestructive('Delete everything?')).rejects.toMatchObject({
      suggestion: expect.stringContaining('--yes'),
    });
  });

  it('skips the TTY check when --yes was passed, even non-interactively', async () => {
    setTTY(false);
    await expect(confirmDestructive('Delete everything?', true)).resolves.toBeUndefined();
  });

  it('proceeds when the user confirms', async () => {
    setTTY(true);
    mockConfirm.mockResolvedValue(true);
    await expect(confirmDestructive('Delete everything?')).resolves.toBeUndefined();
    expect(mockConfirm).toHaveBeenCalledWith({ message: 'Delete everything?', default: false });
  });

  it('aborts when the user declines', async () => {
    setTTY(true);
    mockConfirm.mockResolvedValue(false);
    await expect(confirmDestructive('Delete everything?')).rejects.toThrow(/Aborted/);
  });

  it('defaults the prompt to "no"', async () => {
    setTTY(true);
    mockConfirm.mockResolvedValue(true);
    await confirmDestructive('Delete everything?');
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({ default: false });
  });
});
