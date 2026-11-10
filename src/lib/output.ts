import chalk from 'chalk';
import type { OutputOptions } from '../types';

export function printSuccess(message: string, opts?: OutputOptions): void {
  if (opts?.quiet) return;
  if (opts?.json) return;
  process.stdout.write(chalk.green('✓ ') + message + '\n');
}

export function printInfo(message: string, opts?: OutputOptions): void {
  if (opts?.quiet) return;
  if (opts?.json) return;
  process.stdout.write(message + '\n');
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Goes to stderr so it never contaminates piped output, and is shown even
 * under --json for the same reason: a script consuming stdout keeps parsing,
 * while a human watching the terminal still sees the notice. --quiet silences
 * it, as it does everything else.
 */
export function printWarning(message: string, opts?: OutputOptions): void {
  if (opts?.quiet) return;
  process.stderr.write(chalk.yellow('! ') + message + '\n');
}

export interface ErrorDetails {
  suggestion?: string;
  /** One line per failed field, listed under the headline. */
  problems?: string[];
  /**
   * Printed so a user filing a ticket can hand support the one string that
   * finds the request in the Paubox-side logs.
   */
  requestId?: string;
}

export function printError(message: string, details: ErrorDetails = {}): void {
  process.stderr.write(chalk.red('✗ ') + message + '\n');
  // A single problem is already the headline; only list them when there are several.
  const problems = details.problems ?? [];
  if (problems.length > 1) {
    for (const problem of problems) {
      process.stderr.write(chalk.red('  • ') + problem + '\n');
    }
  }
  if (details.suggestion) {
    process.stderr.write(chalk.dim('  Hint: ') + details.suggestion + '\n');
  }
  if (details.requestId) {
    process.stderr.write(chalk.dim(`  Request ID: ${details.requestId}`) + '\n');
  }
}

/**
 * Errors go to stderr even under --json, so a script reading stdout for results
 * keeps parsing cleanly while still being able to capture a structured failure.
 */
export function printErrorJson(payload: unknown): void {
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
}

export function printTable(rows: Record<string, string>[]): void {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => (r[k] ?? '').length)),
  );
  const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ');
  const divider = widths.map((w) => '-'.repeat(w)).join('  ');
  process.stdout.write(chalk.bold(header) + '\n');
  process.stdout.write(chalk.dim(divider) + '\n');
  for (const row of rows) {
    process.stdout.write(keys.map((k, i) => (row[k] ?? '').padEnd(widths[i])).join('  ') + '\n');
  }
}
