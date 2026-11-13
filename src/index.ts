import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth';
import { registerConfigCommands } from './commands/config';
import { registerDoctorCommand } from './commands/doctor';
import { registerFormsCommands } from './commands/forms';
import { registerReceivingCommands } from './commands/receiving';
import { registerScheduleCommand } from './commands/schedule';
import { registerSendCommand } from './commands/send';
import { registerStatusCommand } from './commands/status';
import { registerWebhookCommands } from './commands/webhooks';
import { ExitCode, PauboxError, ValidationError } from './lib/errors';
import { setClientCommand, setTimeoutSeconds } from './lib/http';
import { printError, printErrorJson } from './lib/output';
import { readPackageVersion } from './lib/version';
import type { OutputOptions } from './types';

/** `forms submit`, not just `submit` — the full path is what identifies the call. */
function commandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;
  while (current && current.name() !== 'paubox') {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join(' ');
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('paubox')
    .description('Official CLI for the Paubox encrypted email API')
    .version(readPackageVersion(), '-v, --version')
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--timeout <seconds>', 'Per-request timeout in seconds (default: 30, plus upload time for large sends)')
    .configureOutput({
      writeErr: (str) => process.stderr.write(str),
    });

  program.hook('preAction', (thisCommand, actionCommand) => {
    // Sent as X-Paubox-Client-Command so Paubox-side logs can attribute an
    // error to a command. The name only — never the arguments.
    setClientCommand(commandPath(actionCommand));

    const timeout = thisCommand.opts<{ timeout?: string }>().timeout;
    if (timeout !== undefined) {
      const seconds = Number(timeout);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new ValidationError(
          `--timeout: "${timeout}" is not a positive number of seconds.`,
          'Pass a value like --timeout 60.',
        );
      }
      setTimeoutSeconds(seconds);
    }
  });

  registerAuthCommands(program);
  registerSendCommand(program);
  registerScheduleCommand(program);
  registerStatusCommand(program);
  registerReceivingCommands(program);
  registerConfigCommands(program);
  registerFormsCommands(program);
  registerWebhookCommands(program);
  registerDoctorCommand(program);

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    const json = program.opts<OutputOptions>().json === true;

    if (err instanceof PauboxError) {
      if (json) {
        printErrorJson(err.toJson());
      } else {
        printError(err.message, {
          suggestion: err.suggestion,
          problems: err instanceof ValidationError ? err.problems : undefined,
          requestId: err.requestId,
        });
      }
      process.exit(err.exitCode);
    }

    // Anything reaching here is a bug rather than a user-facing condition, so
    // keep the stack available under PAUBOX_DEBUG instead of discarding it.
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      printErrorJson({ error: { type: 'general', message } });
    } else {
      printError(message, {
        suggestion:
          'This is an unexpected error. Re-run with PAUBOX_DEBUG=1 for detail, and please ' +
          'report it at https://github.com/Paubox/paubox-cli/issues.',
      });
    }
    if (process.env.PAUBOX_DEBUG && err instanceof Error && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(ExitCode.GENERAL);
  }
}
