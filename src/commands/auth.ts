import { password, select } from '@inquirer/prompts';
import type { Command } from 'commander';
import { PauboxApiClient } from '../lib/api';
import { browserLogin, openInBrowser } from '../lib/browser-login';
import * as credentials from '../lib/credentials';
import { resolveEnvironment } from '../lib/environments';
import { AuthError, PauboxError, ValidationError } from '../lib/errors';
import { IamClient, tokenExpiry } from '../lib/iam-api';
import { printInfo, printJson, printLine, printPrompt, printSuccess, printWarning } from '../lib/output';
import type { OutputOptions, UserSession } from '../types';

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

function onEnvironment(session: Pick<UserSession, 'environment' | 'webUrl'>): string {
  if (session.environment === 'production') return '';
  if (session.environment !== 'custom') return ` on ${session.environment}`;
  try {
    return ` on ${new URL(session.webUrl).host}`;
  } catch {
    return ' on a custom environment';
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface LoginOptions {
  web?: boolean;
  apiKey?: boolean;
  env?: string;
  webUrl?: string;
  iamUrl?: string;
  /** False when --no-browser is passed. */
  browser?: boolean;
}

async function loginWithApiKey(opts: OutputOptions): Promise<void> {
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
}

async function loginWithBrowser(opts: OutputOptions, loginOpts: LoginOptions): Promise<void> {
  const environment = resolveEnvironment({
    env: loginOpts.env,
    webUrl: loginOpts.webUrl,
    iamUrl: loginOpts.iamUrl,
  });

  const { token } = await browserLogin({
    webUrl: environment.webUrl,
    openBrowser: loginOpts.browser === false ? undefined : openInBrowser,
    onReady: ({ url, code, opened }) => {
      printPrompt(`Confirmation code: ${code}`);
      printPrompt(
        opened
          ? 'A browser window has opened. Log in, check the page shows this code, then click Authorize.'
          : 'Open this URL in a browser on this computer, log in, and check the page shows this code:',
      );
      printPrompt(`  ${url}`);
      printPrompt('Waiting for the browser…');
    },
  });

  const me = await new IamClient(environment.iamUrl, token).getEntitlements();
  if (!me.mfa_verified) {
    throw new AuthError('This login has not completed MFA.', 'Run `paubox auth login` and finish MFA in the browser.');
  }

  const now = new Date();
  const session: UserSession = {
    token,
    environment: environment.name,
    webUrl: environment.webUrl,
    iamUrl: environment.iamUrl,
    email: me.email,
    userId: me.id,
    customerId: me.customer_id ?? null,
    customerName: me.customer ?? null,
    expiresAt: (tokenExpiry(token) ?? now).toISOString(),
    createdAt: now.toISOString(),
  };
  const saved = await credentials.saveSession(session);
  const storage = describeStorage(saved);

  if (opts.json) {
    printJson({
      status: 'ok',
      email: session.email,
      customer: session.customerName,
      customerId: session.customerId,
      environment: session.environment,
      expiresAt: session.expiresAt,
      storage,
    });
    return;
  }

  const customer = session.customerName ? ` (${session.customerName})` : '';
  printSuccess(`Logged in as ${session.email}${customer}${onEnvironment(session)}`, opts);
  printInfo(`Session stored in ${storage}. It expires ${formatDate(session.expiresAt)}.`, opts);
}

type SessionState = 'active' | 'expired' | 'revoked' | 'unverified';

interface SessionReport {
  session: UserSession;
  storage: string;
  state: SessionState;
  /** Why the session could not be checked, when state is `unverified`. */
  reason?: string;
}

/** Asks IAM rather than trusting the stored copy: a session can be revoked from the dashboard. */
async function checkSession(stored: { session: UserSession; source: credentials.SaveResult['source'] }): Promise<SessionReport> {
  const storage = describeSource(stored.source);
  const { session } = stored;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    return { session, storage, state: 'expired' };
  }
  try {
    const me = await new IamClient(session.iamUrl, session.token).getEntitlements();
    return {
      session: { ...session, email: me.email, customerName: me.customer ?? session.customerName },
      storage,
      state: me.mfa_verified ? 'active' : 'revoked',
    };
  } catch (err) {
    if (err instanceof AuthError) return { session, storage, state: 'revoked' };
    return { session, storage, state: 'unverified', reason: err instanceof Error ? err.message : String(err) };
  }
}

function sessionJson(report: SessionReport): Record<string, unknown> {
  return {
    state: report.state,
    email: report.session.email,
    customer: report.session.customerName,
    customerId: report.session.customerId,
    environment: report.session.environment,
    expiresAt: report.session.expiresAt,
    storage: report.storage,
  };
}

function printSessionReport(report: SessionReport, opts: OutputOptions): void {
  const { session } = report;
  const who = `${session.email}${session.customerName ? ` (${session.customerName})` : ''}`;
  const where = onEnvironment(session);
  switch (report.state) {
    case 'active':
      printSuccess(
        `Logged in as ${who}${where} (stored in ${report.storage}, expires ${formatDate(session.expiresAt)})`,
        opts,
      );
      return;
    case 'expired':
      printWarning(`Login session for ${who}${where} has expired. Run \`paubox auth login\`.`, opts);
      return;
    case 'revoked':
      printWarning(`Login session for ${who}${where} is no longer valid. Run \`paubox auth login\`.`, opts);
      return;
    default:
      printWarning(`Logged in as ${who}${where}, but the session could not be checked: ${report.reason}`, opts);
  }
}

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Manage Paubox API authentication');

  auth
    .command('login')
    .description('Log in to Paubox in your browser, or save an API key')
    .option('--web', 'Log in with a web browser')
    .option('--api-key', 'Paste an Email API key instead of logging in with a browser')
    .option('--env <name>', 'Paubox environment for browser login: production or staging')
    .option('--web-url <url>', 'Dashboard URL to log in at, e.g. a local paubox-next (overrides --env)')
    .option('--iam-url <url>', 'IAM URL that checks the session (overrides --env)')
    .option('--no-browser', 'Print the login URL instead of opening a browser')
    .action(async (loginOpts: LoginOptions) => {
      const opts = program.opts<OutputOptions>();

      const browserFlags =
        loginOpts.web || loginOpts.env || loginOpts.webUrl || loginOpts.iamUrl || loginOpts.browser === false;
      if (loginOpts.apiKey && browserFlags) {
        throw new ValidationError(
          '--api-key cannot be combined with browser login options.',
          'Use `paubox auth login --api-key` on its own, or drop --api-key to log in with a browser.',
        );
      }

      let mode: 'web' | 'api-key';
      if (loginOpts.apiKey) {
        mode = 'api-key';
      } else if (browserFlags) {
        mode = 'web';
      } else if (process.stdin.isTTY && process.stdout.isTTY && !opts.json) {
        mode = await select({
          message: 'How would you like to log in?',
          choices: [
            { name: 'Log in with a web browser', value: 'web' as const },
            { name: 'Paste an Email API key', value: 'api-key' as const },
          ],
        });
      } else {
        // Without a terminal there is no one to choose, so keep the pre-browser behaviour.
        mode = 'api-key';
      }

      if (mode === 'web') {
        await loginWithBrowser(opts, loginOpts);
      } else {
        await loginWithApiKey(opts);
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
    .description('Remove stored API keys and log out of the browser login session')
    .action(async () => {
      const opts = program.opts<OutputOptions>();

      const stored = await credentials.loadSession();
      let revokeError: string | undefined;
      if (stored) {
        try {
          await new IamClient(stored.session.iamUrl, stored.session.token).signOut();
        } catch (err) {
          // An already-dead session is the goal anyway; anything else is worth saying.
          if (!(err instanceof AuthError)) revokeError = err instanceof Error ? err.message : String(err);
        }
      }

      await credentials.clearCredentials();
      await credentials.clearSession();

      if (revokeError) {
        printWarning(
          `Could not revoke the login session at Paubox (${revokeError}). It was removed from this computer and expires on its own.`,
          opts,
        );
      }
      if (opts.json) {
        printJson({ status: 'ok' });
      } else {
        printSuccess('Credentials removed.', opts);
      }
    });

  auth
    .command('token')
    .description('Print the browser login session token, for tools that act as you (such as the Paubox MCP server)')
    .action(async () => {
      const opts = program.opts<OutputOptions>();
      const stored = await credentials.loadSession();
      if (!stored) {
        throw new AuthError('Not logged in with a browser session.', 'Run `paubox auth login --web`.');
      }
      const { session } = stored;
      if (Date.parse(session.expiresAt) <= Date.now()) {
        throw new AuthError('Your Paubox login session has expired.', 'Run `paubox auth login --web`.');
      }

      if (opts.json) {
        printJson({
          token: session.token,
          email: session.email,
          customerId: session.customerId,
          customer: session.customerName,
          environment: session.environment,
          webUrl: session.webUrl,
          iamUrl: session.iamUrl,
          expiresAt: session.expiresAt,
        });
      } else {
        printLine(session.token);
      }
    });

  auth
    .command('status')
    .description('Show authentication status')
    .action(async () => {
      const opts = program.opts<OutputOptions>();
      const storedSession = await credentials.loadSession();
      const sessionReport = storedSession ? await checkSession(storedSession) : null;
      const sessionField = sessionReport ? { session: sessionJson(sessionReport) } : {};

      const creds = await credentials.loadCredentials();
      const emailAuthenticated = Boolean(creds && creds.apiKey);
      const maskedFormsKey = creds?.formsApiKey
        ? credentials.maskApiKey(creds.formsApiKey)
        : null;

      if (!creds || (!emailAuthenticated && !maskedFormsKey)) {
        if (opts.json) {
          printJson({ authenticated: false, formsApiKey: null, ...sessionField });
        } else if (sessionReport) {
          printSessionReport(sessionReport, opts);
          printInfo('Email API key: not set. Run `paubox auth login --api-key` to add one for sending.', opts);
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
            ...sessionField,
          });
        } else {
          printJson({ authenticated: false, formsApiKey: maskedFormsKey, storage: formsStorage, ...sessionField });
        }
        return;
      }

      if (sessionReport) printSessionReport(sessionReport, opts);

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
