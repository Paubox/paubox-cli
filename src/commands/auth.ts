import { input, password } from '@inquirer/prompts';
import type { Command } from 'commander';
import { PauboxApiClient } from '../lib/api';
import * as credentials from '../lib/credentials';
import { AuthError } from '../lib/errors';
import { printError, printInfo, printJson, printSuccess } from '../lib/output';
import type { OutputOptions } from '../types';

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Manage Paubox API authentication');

  auth
    .command('login')
    .description('Save API credentials')
    .action(async () => {
      const opts = program.opts<OutputOptions>();
      try {
        const apiUsername = await input({ message: 'API username (endpoint name):' });
        const apiKey = await password({ message: 'API key:', mask: '*' });

        if (!apiUsername.trim() || !apiKey.trim()) {
          throw new AuthError('API username and API key are required.');
        }

        printInfo('Validating credentials…', opts);
        const client = new PauboxApiClient({ apiUsername: apiUsername.trim(), apiKey: apiKey.trim() });
        const valid = await client.validateCredentials();
        if (!valid) {
          throw new AuthError(
            'Credentials are invalid.',
            'Check your API username and key in the Paubox dashboard.',
          );
        }

        await credentials.saveCredentials({
          apiUsername: apiUsername.trim(),
          apiKey: apiKey.trim(),
        });

        const storage = credentials.usingKeychain() ? 'OS keychain' : 'config file';
        if (opts.json) {
          printJson({ status: 'ok', apiUsername: apiUsername.trim(), storage });
        } else {
          printSuccess(`Authenticated as ${apiUsername.trim()} (stored in ${storage})`, opts);
        }
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError(String(err));
      }
    });

  auth
    .command('logout')
    .description('Remove stored credentials')
    .action(async () => {
      const opts = program.opts<OutputOptions>();
      await credentials.clearCredentials();
      if (opts.json) {
        printJson({ status: 'ok' });
      } else {
        printSuccess('Credentials removed.', opts);
      }
    });

  auth
    .command('status')
    .description('Show authentication status')
    .action(async () => {
      const opts = program.opts<OutputOptions>();
      const creds = await credentials.loadCredentials();
      if (!creds) {
        if (opts.json) {
          printJson({ authenticated: false });
        } else {
          printInfo('Not authenticated. Run `paubox auth login`.', opts);
        }
        return;
      }
      const storage = credentials.usingKeychain() ? 'OS keychain' : 'config file';
      const masked = credentials.maskApiKey(creds.apiKey);
      if (opts.json) {
        printJson({ authenticated: true, apiUsername: creds.apiUsername, apiKey: masked, storage });
      } else {
        printSuccess(
          `Authenticated as ${creds.apiUsername} (API key: ${masked}, stored in ${storage})`,
          opts,
        );
      }
    });
}

export { printError };
