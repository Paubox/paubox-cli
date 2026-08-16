import { confirm } from '@inquirer/prompts';
import { ConfigError } from './errors';

/**
 * Gate an irreversible operation behind an interactive confirmation.
 *
 * Passing `skip` (from `--yes`) bypasses the prompt. In a non-interactive shell
 * there is nobody to answer, so this refuses rather than hanging on a prompt
 * that will never be read -- scripts must opt in explicitly with `--yes`.
 */
export async function confirmDestructive(message: string, skip = false): Promise<void> {
  if (skip) return;

  if (!process.stdin.isTTY) {
    throw new ConfigError(
      `Refusing to run without confirmation: ${message}`,
      'Pass --yes to confirm when running non-interactively.',
    );
  }

  const proceed = await confirm({ message, default: false });
  if (!proceed) {
    throw new ConfigError('Aborted.');
  }
}
