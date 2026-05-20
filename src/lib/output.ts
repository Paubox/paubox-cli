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

export function printError(message: string, suggestion?: string): void {
  process.stderr.write(chalk.red('✗ ') + message + '\n');
  if (suggestion) {
    process.stderr.write(chalk.dim('  Hint: ') + suggestion + '\n');
  }
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
