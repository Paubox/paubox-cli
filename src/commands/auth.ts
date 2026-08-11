import { input, password } from '@inquirer/prompts';
import type { Command } from 'commander';
import { PauboxApiClient } from '../lib/api';
import * as credentials from '../lib/credentials';
import { AuthError } from '../lib/errors';
import { printInfo, printJson, printSuccess } from '../lib/output';
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

        const existing = await credentials.loadCredentials();
        await credentials.saveCredentials({
          apiUsername: apiUsername.trim(),
          apiKey: apiKey.trim(),
          ...(existing?.formsApiKey ? { formsApiKey: existing.formsApiKey } : {}),
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
    .command('set-forms-key')
    .description('Save a Forms API key (scoped key with the "forms" scope)')
    .action(async () => {
      const opts = program.opts<OutputOptions>();
      try {
        const formsApiKey = await password({
          message: "Forms API key (scoped key with the 'forms' scope):",
          mask: '*',
        });

        if (!formsApiKey.trim()) {
          throw new AuthError('Forms API key is required.');
        }

        const existing = await credentials.loadCredentials();
        await credentials.saveCredentials({
          apiUsername: existing?.apiUsername ?? '',
          apiKey: existing?.apiKey ?? '',
          formsApiKey: formsApiKey.trim(),
        });

        const storage = credentials.usingKeychain() ? 'OS keychain' : 'config file';
        const masked = credentials.maskApiKey(formsApiKey.trim());
        if (opts.json) {
          printJson({ status: 'ok', formsApiKey: masked, storage });
        } else {
          printSuccess(`Forms API key saved (${masked}, stored in ${storage})`, opts);
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
      const emailAuthenticated = Boolean(creds && creds.apiUsername && creds.apiKey);
      const maskedFormsKey = creds?.formsApiKey
        ? credentials.maskApiKey(creds.formsApiKey)
        : null;

      if (!creds || (!emailAuthenticated && !maskedFormsKey)) {
        if (opts.json) {
          printJson({ authenticated: false, formsApiKey: null });
        } else {
          printInfo('Not authenticated. Run `paubox auth login`.', opts);
        }
        return;
      }

      const storage = credentials.usingKeychain() ? 'OS keychain' : 'config file';
      if (opts.json) {
        if (emailAuthenticated) {
          printJson({
            authenticated: true,
            apiUsername: creds.apiUsername,
            apiKey: credentials.maskApiKey(creds.apiKey),
            formsApiKey: maskedFormsKey,
            storage,
          });
        } else {
          printJson({ authenticated: false, formsApiKey: maskedFormsKey, storage });
        }
        return;
      }

      if (emailAuthenticated) {
        const masked = credentials.maskApiKey(creds.apiKey);
        printSuccess(
          `Authenticated as ${creds.apiUsername} (API key: ${masked}, stored in ${storage})`,
          opts,
        );
        if (maskedFormsKey) {
          printSuccess(`Forms API key: ${maskedFormsKey} (stored in ${storage})`, opts);
        } else {
          printInfo('Forms API key: not set. Run `paubox auth set-forms-key`.', opts);
        }
      } else {
        printInfo('Email API: not authenticated. Run `paubox auth login`.', opts);
        printSuccess(`Forms API key: ${maskedFormsKey} (stored in ${storage})`, opts);
      }
    });
}
