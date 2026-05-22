import { readFileSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth';
import { registerConfigCommands } from './commands/config';
import { registerFormsCommands } from './commands/forms';
import { registerSendCommand } from './commands/send';
import { registerStatusCommand } from './commands/status';
import { PauboxError } from './lib/errors';
import { printError } from './lib/output';

// Read version from package.json at runtime. Both the compiled entry
// (dist/index.js) and the source entry (src/index.ts) sit one level
// below the package root, so the relative path resolves correctly in
// dev (tsx) and in the published tarball.
function readPackageVersion(): string {
  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('paubox')
    .description('Official CLI for the Paubox encrypted email API')
    .version(readPackageVersion(), '-v, --version')
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--verbose', 'Show detailed request/response information for debugging')
    .configureOutput({
      writeErr: (str) => process.stderr.write(str),
    });

  program.hook('postAction', () => {
    // no-op; errors are caught in parseAsync caller
  });

  registerAuthCommands(program);
  registerSendCommand(program);
  registerStatusCommand(program);
  registerConfigCommands(program);
  registerFormsCommands(program);

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof PauboxError) {
      printError(err.message, err.suggestion);
      process.exit(err.exitCode);
    }
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
