import { ConfigError } from './errors';

export type EnvironmentName = 'production' | 'staging';

export interface Environment {
  /** `production`, `staging`, or `custom` when either URL was overridden. */
  name: string;
  /** The Paubox dashboard (paubox-next), where the browser login happens. */
  webUrl: string;
  /** IAM, which issues and checks user sessions. */
  iamUrl: string;
}

export const ENVIRONMENTS: Record<EnvironmentName, Omit<Environment, 'name'>> = {
  production: {
    webUrl: 'https://next.paubox.com',
    iamUrl: 'https://apx.paubox.com/iam',
  },
  staging: {
    webUrl: 'https://next.staging.paubox.net',
    iamUrl: 'https://api.staging.paubox.net/iam',
  },
};

export const ENV_ENVIRONMENT = 'PAUBOX_ENV';
export const ENV_WEB_URL = 'PAUBOX_WEB_URL';
export const ENV_IAM_URL = 'PAUBOX_IAM_URL';

export interface EnvironmentOptions {
  env?: string;
  webUrl?: string;
  iamUrl?: string;
}

function normalizeUrl(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConfigError(`${label} "${raw}" is not a valid URL.`, 'Pass an absolute https:// URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`${label} "${raw}" must be an http(s) URL.`, 'Pass an absolute https:// URL.');
  }
  return url.toString().replace(/\/+$/, '');
}

/**
 * Flags win over environment variables, which win over the named environment's
 * defaults. Overriding either URL makes the environment `custom`, so a session
 * minted against a local dashboard is never labelled as production.
 */
export function resolveEnvironment(
  opts: EnvironmentOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Environment {
  const requested = (opts.env ?? env[ENV_ENVIRONMENT] ?? 'production').trim().toLowerCase();
  if (!(requested in ENVIRONMENTS)) {
    throw new ConfigError(
      `Unknown environment "${requested}".`,
      `Use one of: ${Object.keys(ENVIRONMENTS).join(', ')}.`,
    );
  }
  const base = ENVIRONMENTS[requested as EnvironmentName];

  const webOverride = opts.webUrl ?? env[ENV_WEB_URL];
  const iamOverride = opts.iamUrl ?? env[ENV_IAM_URL];

  return {
    name: webOverride || iamOverride ? 'custom' : requested,
    webUrl: webOverride ? normalizeUrl(webOverride, '--web-url') : base.webUrl,
    iamUrl: iamOverride ? normalizeUrl(iamOverride, '--iam-url') : base.iamUrl,
  };
}
