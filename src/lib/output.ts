import chalk from 'chalk';
import type { OutputOptions } from '../types';

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

export function printVerbose(label: string, data: string): void {
  if (!verboseEnabled) return;
  process.stderr.write(chalk.cyan(`[${label}] `) + data + '\n');
}

export function printVerboseRequest(method: string, url: string, headers: Record<string, string>, body?: string): void {
  if (!verboseEnabled) return;
  process.stderr.write(chalk.cyan('\n--- REQUEST ---\n'));
  process.stderr.write(chalk.cyan('Method: ') + method + '\n');
  process.stderr.write(chalk.cyan('URL: ') + url + '\n');
  process.stderr.write(chalk.cyan('Headers:\n'));
  for (const [key, value] of Object.entries(headers)) {
    process.stderr.write(`  ${key}: ${value}\n`);
  }
  if (body) {
    const truncated = body.length > 2000 ? body.slice(0, 2000) + '... (truncated)' : body;
    process.stderr.write(chalk.cyan('Body:\n') + truncated + '\n');
  }
}

export function printVerboseResponse(status: number, statusText: string, body?: string): void {
  if (!verboseEnabled) return;
  process.stderr.write(chalk.cyan('\n--- RESPONSE ---\n'));
  process.stderr.write(chalk.cyan('Status: ') + `${status} ${statusText}\n`);
  if (body) {
    const truncated = body.length > 2000 ? body.slice(0, 2000) + '... (truncated)' : body;
    process.stderr.write(chalk.cyan('Body:\n') + truncated + '\n');
  }
  process.stderr.write('\n');
}

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
