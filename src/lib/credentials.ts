import * as configStore from './config-store';
import type { PauboxCredentials, UserSession } from '../types';

const KEYCHAIN_SERVICE = 'paubox-cli';
const KEYCHAIN_ACCOUNT = 'default';
/** A separate entry, so saving or clearing the API keys never touches the login session. */
const KEYCHAIN_SESSION_ACCOUNT = 'session';

export const ENV_API_KEY = 'PAUBOX_API_KEY';
export const ENV_FORMS_API_KEY = 'PAUBOX_FORMS_API_KEY';

/** Where a credential actually came from, as opposed to where we hoped it would. */
export type CredentialSource = 'environment' | 'keychain' | 'file';

export interface SaveResult {
  source: Exclude<CredentialSource, 'environment'>;
  /** Set when the keychain was present but refused, e.g. no D-Bus in a container. */
  keychainError?: string;
}

interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

function loadKeytar(): KeytarModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('keytar') as KeytarModule;
  } catch {
    return null;
  }
}

/**
 * Credentials supplied by the environment, which outrank anything stored.
 *
 * This is the only path that needs no keychain and no writable config, so it
 * is what makes the CLI usable in a container, in CI, over SSH, and under WSL.
 * `PAUBOX_API_KEY` matches the name the MCP server already uses.
 */
function envOverlay(): Partial<PauboxCredentials> {
  const overlay: Partial<PauboxCredentials> = {};
  const apiKey = process.env[ENV_API_KEY]?.trim();
  const formsApiKey = process.env[ENV_FORMS_API_KEY]?.trim();
  if (apiKey) overlay.apiKey = apiKey;
  if (formsApiKey) overlay.formsApiKey = formsApiKey;
  return overlay;
}

function parseBlob(raw: string): PauboxCredentials | null {
  try {
    return JSON.parse(raw) as PauboxCredentials;
  } catch {
    return null;
  }
}

/**
 * Reads whatever is stored, without ever throwing.
 *
 * keytar can be installed and still fail at call time — a Linux container with
 * no session bus raises "Cannot autolaunch D-Bus without X11 $DISPLAY". The
 * old code caught only a failed `require`, so that error escaped and every
 * command died before it could reach the config file it was supposed to fall
 * back to. A keychain miss falls through here too: having keytar available
 * does not mean the credential was stored there.
 */
async function readStored(): Promise<{
  creds: PauboxCredentials | null;
  source: Exclude<CredentialSource, 'environment'>;
  keychainError?: string;
}> {
  const keytar = loadKeytar();

  if (keytar) {
    try {
      const raw = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (raw) {
        const parsed = parseBlob(raw);
        if (parsed) return { creds: parsed, source: 'keychain' };
      }
    } catch (err) {
      return {
        creds: configStore.getCredentials(),
        source: 'file',
        keychainError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { creds: configStore.getCredentials(), source: 'file' };
}

/** Per key, because the environment overlay applies per field. */
export interface CredentialSources {
  apiKey: CredentialSource | null;
  formsApiKey: CredentialSource | null;
}

let lastSource: CredentialSource | null = null;
let lastSources: CredentialSources = { apiKey: null, formsApiKey: null };
let lastKeychainError: string | undefined;

/** How the most recent load or save resolved overall. Null before either has run. */
export function credentialSource(): CredentialSource | null {
  return lastSource;
}

/**
 * Where each key came from. One can arrive from the environment while the
 * other is still read from the keychain, so a single answer would be wrong
 * about one of them.
 */
export function credentialSources(): CredentialSources {
  return { ...lastSources };
}

/** The keychain's complaint, when there was one and we fell back because of it. */
export function keychainError(): string | undefined {
  return lastKeychainError;
}

export async function saveCredentials(creds: PauboxCredentials): Promise<SaveResult> {
  const keytar = loadKeytar();

  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, JSON.stringify(creds));
      lastSource = 'keychain';
      lastSources = { apiKey: 'keychain', formsApiKey: creds.formsApiKey ? 'keychain' : null };
      lastKeychainError = undefined;
      return { source: 'keychain' };
    } catch (err) {
      // Falling back rather than failing: without this there is no way to
      // authenticate at all on a headless box, because the config file the
      // user would be told to use can only be written through this function.
      // The caller reports the downgrade so plaintext storage stays visible.
      const keychainError = err instanceof Error ? err.message : String(err);
      configStore.saveCredentials(creds);
      lastSource = 'file';
      lastSources = { apiKey: 'file', formsApiKey: creds.formsApiKey ? 'file' : null };
      lastKeychainError = keychainError;
      return { source: 'file', keychainError };
    }
  }

  configStore.saveCredentials(creds);
  lastSource = 'file';
  lastSources = { apiKey: 'file', formsApiKey: creds.formsApiKey ? 'file' : null };
  lastKeychainError = undefined;
  return { source: 'file' };
}

export async function loadCredentials(): Promise<PauboxCredentials | null> {
  const stored = await readStored();
  const overlay = envOverlay();

  lastKeychainError = stored.keychainError;

  // Per field, so `PAUBOX_FORMS_API_KEY=... paubox webhooks list` works against
  // an Email key that is already in the keychain, and vice versa.
  if (overlay.apiKey !== undefined || overlay.formsApiKey !== undefined) {
    lastSource = 'environment';
    lastSources = {
      apiKey: overlay.apiKey !== undefined ? 'environment' : stored.creds?.apiKey ? stored.source : null,
      formsApiKey:
        overlay.formsApiKey !== undefined
          ? 'environment'
          : stored.creds?.formsApiKey
            ? stored.source
            : null,
    };
    return {
      apiKey: overlay.apiKey ?? stored.creds?.apiKey ?? '',
      ...((overlay.formsApiKey ?? stored.creds?.formsApiKey) !== undefined
        ? { formsApiKey: overlay.formsApiKey ?? stored.creds?.formsApiKey }
        : {}),
    };
  }

  lastSource = stored.source;
  lastSources = {
    apiKey: stored.creds?.apiKey ? stored.source : null,
    formsApiKey: stored.creds?.formsApiKey ? stored.source : null,
  };
  return stored.creds;
}

export async function clearCredentials(): Promise<void> {
  const keytar = loadKeytar();

  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    } catch {
      // Ignored on purpose: a keychain we cannot reach holds nothing we can
      // delete, and the file copy below is the one that would otherwise be
      // left behind.
    }
  }

  // Always clear the file too. A fallback write may have put credentials there
  // even on a machine where the keychain normally works.
  configStore.clearCredentials();
  lastSource = null;
  lastSources = { apiKey: null, formsApiKey: null };
  lastKeychainError = undefined;
}

/** Stored the same way as the API keys: keychain first, config file when it refuses. */
export async function saveSession(session: UserSession): Promise<SaveResult> {
  const keytar = loadKeytar();

  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION_ACCOUNT, JSON.stringify(session));
      // A file copy from an earlier fallback would otherwise outlive this one.
      configStore.clearSession();
      return { source: 'keychain' };
    } catch (err) {
      configStore.saveSession(session);
      return { source: 'file', keychainError: err instanceof Error ? err.message : String(err) };
    }
  }

  configStore.saveSession(session);
  return { source: 'file' };
}

export async function loadSession(): Promise<{ session: UserSession; source: SaveResult['source'] } | null> {
  const keytar = loadKeytar();

  if (keytar) {
    try {
      const raw = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION_ACCOUNT);
      if (raw) {
        try {
          return { session: JSON.parse(raw) as UserSession, source: 'keychain' };
        } catch {
          // A corrupt entry reads as no session; the next login overwrites it.
        }
      }
    } catch {
      // Same headless case as readStored(): fall through to the file.
    }
  }

  const fromFile = configStore.getSession();
  return fromFile ? { session: fromFile, source: 'file' } : null;
}

export async function clearSession(): Promise<void> {
  const keytar = loadKeytar();

  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_SESSION_ACCOUNT);
    } catch {
      // Unreachable keychain: nothing there to delete. The file is cleared below.
    }
  }

  configStore.clearSession();
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '****';
  return '****' + apiKey.slice(-4);
}

/**
 * Whether keytar is loadable. Says nothing about whether it works — see
 * `credentialSource()` for what a given operation actually used.
 */
export function usingKeychain(): boolean {
  return loadKeytar() !== null;
}
