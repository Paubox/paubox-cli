import type { Command } from 'commander';
import * as credentials from '../lib/credentials';
import { DEFAULT_FORMS_BASE_URL, resolveFormsBaseUrl } from '../lib/forms-api';
import { DEFAULT_WEBHOOKS_BASE_URL, resolveWebhooksBaseUrl } from '../lib/webhooks-api';
import { PauboxError } from '../lib/errors';
import { clientHeaders, newRequestId } from '../lib/http';
import { printInfo, printJson, printTable } from '../lib/output';
import { readPackageVersion } from '../lib/version';
import type { OutputOptions } from '../types';

const EMAIL_BASE_URL = 'https://api.paubox.com/v1/email';
const PROBE_TIMEOUT_MS = 10_000;

export interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

interface ProbeKey {
  /** Human name of the key, as the auth commands call it. */
  label: string;
  /** Full Authorization header value. */
  authorization: string;
  /** Command that replaces this key. */
  fix: string;
}

/**
 * One request per service, carrying the same key the real commands would send.
 * Any HTTP answer proves DNS, TLS and routing; the status then says whether
 * the key is accepted (401 = rejected, 403 = accepted but not scoped for it).
 * A 404 on the probe path is fine: a valid key on an unknown id answers 404.
 */
async function probe(name: string, url: string, key: ProbeKey | null): Promise<Check> {
  const requestId = newRequestId();
  const headers: Record<string, string> = { ...clientHeaders(requestId) };
  if (key) headers.Authorization = key.authorization;

  let status: number;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    status = response.status;
  } catch (err) {
    const reason = err instanceof Error ? (err.name === 'TimeoutError' ? 'timed out' : err.message) : String(err);
    return { name, status: 'fail', detail: `unreachable: ${reason}` };
  }

  if (!key) {
    return { name, status: 'warn', detail: `reachable (HTTP ${status}); no key stored to test` };
  }
  if (status === 401) {
    return { name, status: 'fail', detail: `${key.label} rejected (HTTP 401) — ${key.fix}` };
  }
  if (status === 403) {
    return {
      name,
      status: 'warn',
      detail: `${key.label} accepted but not scoped for this API (HTTP 403)`,
    };
  }
  if (status >= 500) {
    return { name, status: 'fail', detail: `server error (HTTP ${status}); request id ${requestId}` };
  }
  return { name, status: 'ok', detail: `${key.label} accepted (HTTP ${status})` };
}

function credentialCheck(
  name: string,
  key: string | undefined,
  hint: string,
): Check {
  return key
    ? { name, status: 'ok', detail: `stored (${credentials.maskApiKey(key)})` }
    : { name, status: 'warn', detail: `not set — ${hint}` };
}

export function summarize(checks: Check[]): string {
  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;
  if (failures > 0) return `${failures} check(s) failed${warnings ? `, ${warnings} warning(s)` : ''}.`;
  if (warnings > 0) return `No failures; ${warnings} warning(s).`;
  return 'No problems found.';
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check this machine: runtime, stored credentials, and API reachability')
    .action(async () => {
      const opts = program.opts<OutputOptions>();

      const checks: Check[] = [
        { name: 'paubox-cli', status: 'ok', detail: readPackageVersion() },
        { name: 'node', status: 'ok', detail: `${process.version} on ${process.platform} ${process.arch}` },
      ];

      let creds: Awaited<ReturnType<typeof credentials.loadCredentials>> = null;
      try {
        creds = await credentials.loadCredentials();
        checks.push({
          name: 'credential store',
          status: 'ok',
          detail: credentials.usingKeychain() ? 'OS keychain' : 'config file',
        });
      } catch (err) {
        checks.push({
          name: 'credential store',
          status: 'fail',
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      checks.push(
        credentialCheck('Email API key', creds?.apiKey, 'run `paubox auth login`'),
        credentialCheck('Forms API key', creds?.formsApiKey, 'run `paubox auth set-forms-key`'),
      );

      // A bad base-URL override is a common and silent cause of "nothing works".
      for (const [name, resolve, fallback] of [
        ['Forms base URL', resolveFormsBaseUrl, DEFAULT_FORMS_BASE_URL],
        ['Webhooks base URL', resolveWebhooksBaseUrl, DEFAULT_WEBHOOKS_BASE_URL],
      ] as const) {
        try {
          const resolved = resolve();
          checks.push({
            name,
            status: 'ok',
            detail: resolved === fallback ? `${resolved} (default)` : `${resolved} (overridden)`,
          });
        } catch (err) {
          checks.push({
            name,
            status: 'fail',
            detail: err instanceof PauboxError ? err.message : String(err),
          });
        }
      }

      const emailKey: ProbeKey | null = creds?.apiKey
        ? { label: 'Email API key', authorization: `Token token=${creds.apiKey}`, fix: 'run `paubox auth login`' }
        : null;
      const formsKey: ProbeKey | null = creds?.formsApiKey
        ? { label: 'Forms API key', authorization: `Bearer ${creds.formsApiKey}`, fix: 'run `paubox auth set-forms-key`' }
        : null;
      // Same preference as the webhooks commands: the narrower Forms key first.
      const webhooksKey: ProbeKey | null = creds?.formsApiKey
        ? formsKey
        : creds?.apiKey
          ? { label: 'Email API key', authorization: `Bearer ${creds.apiKey}`, fix: 'run `paubox auth login`' }
          : null;

      const probes = await Promise.all([
        probe('Email API', `${EMAIL_BASE_URL}/message_receipt?sourceTrackingId=doctor`, emailKey),
        probe('Forms API', `${safeResolve(resolveFormsBaseUrl, DEFAULT_FORMS_BASE_URL)}/api/forms`, formsKey),
        probe('Webhooks API', `${safeResolve(resolveWebhooksBaseUrl, DEFAULT_WEBHOOKS_BASE_URL)}/endpoints`, webhooksKey),
      ]);
      checks.push(...probes);

      if (opts.json) {
        printJson({ checks });
      } else {
        printTable(
          checks.map((check) => ({
            check: check.name,
            status: check.status.toUpperCase(),
            detail: check.detail,
          })),
        );
        printInfo(`\n${summarize(checks)}`, opts);
      }

      // Scripts and CI can gate on `paubox doctor` without parsing the table.
      if (checks.some((check) => check.status === 'fail')) {
        process.exitCode = 1;
      }
    });
}

function safeResolve(resolve: () => string, fallback: string): string {
  try {
    return resolve();
  } catch {
    return fallback;
  }
}
