import { password } from '@inquirer/prompts';
import type { Command } from 'commander';
import { PauboxApiClient } from '../lib/api';
import * as credentials from '../lib/credentials';
import { AuthError, PauboxError } from '../lib/errors';
import { printInfo, printJson, printSuccess } from '../lib/output';
import type { OutputOptions } from '../types';

/**
 * Reports where the credential actually landed, not where we hoped it would.
 * Saying "OS keychain" after falling back to a plaintext file would understate
 * how the secret is protected.
 */
function describeStorage(saved: credentials.SaveResult): string {
  if (saved.source === 'keychain') return 'OS keychain';
  if (saved.keychainError) return 'config file (OS keychain unavailable)';
  return 'config file';
}

function describeSource(source: credentials.CredentialSource | null): string {
  switch (source) {
    case 'environment':
      return 'environment';
    case 'keychain':
      return 'OS keychain';
    default:
      return 'config file';
  }
}

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
        const apiKey = await password({ message: 'API key:', mask: '*' });

        if (!apiKey.trim()) {
          throw new AuthError('API key is required.');
        }

        printInfo('Validating credentials…', opts);
        const client = new PauboxApiClient({ apiKey: apiKey.trim() });
        const valid = await client.validateCredentials();
        if (!valid) {
          throw AuthError.invalid('email');
        }

        const existing = await credentials.loadCredentials();
        const saved = await credentials.saveCredentials({
          apiKey: apiKey.trim(),
          ...(existing?.formsApiKey ? { formsApiKey: existing.formsApiKey } : {}),
        });

        const storage = describeStorage(saved);
        const masked = credentials.maskApiKey(apiKey.trim());
        if (opts.json) {
          printJson({ status: 'ok', apiKey: masked, storage });
        } else {
          printSuccess(`Authenticated (API key: ${masked}, stored in ${storage})`, opts);
        }
      } catch (err) {
        // Only an unrecognised failure becomes an AuthError. Flattening a
        // NetworkError into "credentials are invalid" is how a DNS outage used
        // to read as a bad API key.
        if (err instanceof PauboxError) throw err;
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

        // Build the object explicitly (no spread) so legacy fields from
        // pre-key-only stored blobs are dropped rather than re-persisted.
        const existing = await credentials.loadCredentials();
        const saved = await credentials.saveCredentials({
          apiKey: existing?.apiKey ?? '',
          formsApiKey: formsApiKey.trim(),
        });

        const storage = describeStorage(saved);
        const masked = credentials.maskApiKey(formsApiKey.trim());
        if (opts.json) {
          printJson({ status: 'ok', formsApiKey: masked, storage });
        } else {
          printSuccess(`Forms API key saved (${masked}, stored in ${storage})`, opts);
        }
      } catch (err) {
        // Only an unrecognised failure becomes an AuthError. Flattening a
        // NetworkError into "credentials are invalid" is how a DNS outage used
        // to read as a bad API key.
        if (err instanceof PauboxError) throw err;
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
      const emailAuthenticated = Boolean(creds && creds.apiKey);
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

      // Reported per key: with only PAUBOX_API_KEY set, the Email key comes
      // from the environment while the Forms key is still read from the
      // keychain, and one label for both would be wrong about one of them.
      const sources = credentials.credentialSources();
      const storage = describeSource(sources.apiKey ?? credentials.credentialSource());
      const formsStorage = describeSource(sources.formsApiKey ?? credentials.credentialSource());
      if (opts.json) {
        if (emailAuthenticated) {
          printJson({
            authenticated: true,
            apiKey: credentials.maskApiKey(creds.apiKey),
            formsApiKey: maskedFormsKey,
            storage,
            ...(maskedFormsKey ? { formsStorage } : {}),
          });
        } else {
          printJson({ authenticated: false, formsApiKey: maskedFormsKey, storage: formsStorage });
        }
        return;
      }

      if (emailAuthenticated) {
        const masked = credentials.maskApiKey(creds.apiKey);
        printSuccess(`Authenticated (API key: ${masked}, stored in ${storage})`, opts);
        if (maskedFormsKey) {
          printSuccess(`Forms API key: ${maskedFormsKey} (stored in ${formsStorage})`, opts);
        } else {
          printInfo('Forms API key: not set. Run `paubox auth set-forms-key`.', opts);
        }
      } else {
        printInfo('Email API: not authenticated. Run `paubox auth login`.', opts);
        printSuccess(`Forms API key: ${maskedFormsKey} (stored in ${formsStorage})`, opts);
      }
    });
}
