import type { Command } from 'commander';
import * as configStore from '../lib/config-store';
import { ConfigError } from '../lib/errors';
import { printInfo, printJson, printSuccess, printTable } from '../lib/output';
import type { OutputOptions } from '../types';

const ALLOWED_KEYS = ['defaultFrom'] as const;
type ConfigKey = (typeof ALLOWED_KEYS)[number];

function assertAllowedKey(key: string): asserts key is ConfigKey {
  if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
    throw new ConfigError(
      `Unknown config key: "${key}". Allowed keys: ${ALLOWED_KEYS.join(', ')}`,
    );
  }
}

export function registerConfigCommands(program: Command): void {
  const config = program
    .command('config')
    .description('Manage CLI configuration');

  config
    .command('set <key> <value>')
    .description('Set a config value')
    .action((key: string, value: string) => {
      const opts = program.opts<OutputOptions>();
      assertAllowedKey(key);
      configStore.setConfigValue(key, value);
      if (opts.json) {
        printJson({ key, value });
      } else {
        printSuccess(`Set ${key} = ${value}`, opts);
      }
    });

  config
    .command('get <key>')
    .description('Get a config value')
    .action((key: string) => {
      const opts = program.opts<OutputOptions>();
      const value = configStore.getConfigValue(key);
      if (value === undefined) {
        throw new ConfigError(`Key not set: "${key}". Run \`paubox config set ${key} <value>\`.`);
      }
      if (opts.json) {
        printJson({ key, value });
      } else {
        printInfo(value, opts);
      }
    });

  config
    .command('list')
    .description('List all config values')
    .action(() => {
      const opts = program.opts<OutputOptions>();
      const all = configStore.listConfig();
      const entries = Object.entries(all).filter(([, v]) => v !== undefined) as [string, string][];
      if (opts.json) {
        printJson(Object.fromEntries(entries));
        return;
      }
      if (entries.length === 0) {
        printInfo('No configuration set. Use `paubox config set <key> <value>`.', opts);
        return;
      }
      printTable(entries.map(([key, value]) => ({ key, value })));
    });

  config
    .command('reset')
    .description('Reset all config values')
    .action(() => {
      const opts = program.opts<OutputOptions>();
      configStore.resetConfig();
      if (opts.json) {
        printJson({ status: 'ok' });
      } else {
        printSuccess('Configuration reset.', opts);
      }
    });
}
