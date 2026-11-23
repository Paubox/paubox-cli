import * as configStore from './config-store';
import type { PauboxCredentials } from '../types';

const KEYCHAIN_SERVICE = 'paubox-cli';
const KEYCHAIN_ACCOUNT = 'default';

/** Environment variables that supply credentials without any stored state. */
export const API_KEY_ENV = 'PAUBOX_API_KEY';
export const FORMS_API_KEY_ENV = 'PAUBOX_FORMS_API_KEY';

interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * Why the keychain could not be used in this process, if it failed.
 *
 * keytar installing is not the same as keytar working: on a headless Linux box
 * (Docker, CI, WSL, cloud sessions) libsecret throws "Cannot autolaunch D-Bus
 * without X11 $DISPLAY" on the first call. Once that happens the config file
 * takes over for the rest of the process rather than failing every command.
 */
let keychainError: string | null = null;

function loadKeytar(): KeytarModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('keytar') as KeytarModule;
  } catch {
    return null;
  }
}

function keychain(): KeytarModule | null {
  return keychainError === null ? loadKeytar() : null;
}

function markKeychainFailed(err: unknown): void {
  keychainError = err instanceof Error ? err.message : String(err);
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Which credentials come from the environment rather than the store. */
export function envCredentials(): { apiKey?: string; formsApiKey?: string } {
  return { apiKey: readEnv(API_KEY_ENV), formsApiKey: readEnv(FORMS_API_KEY_ENV) };
}

export async function saveCredentials(creds: PauboxCredentials): Promise<void> {
  const keytar = keychain();
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, JSON.stringify(creds));
      return;
    } catch (err) {
      markKeychainFailed(err);
    }
  }
  configStore.saveCredentials(creds);
}

/**
 * Credentials as stored by `paubox auth`, ignoring the environment. The auth
 * commands read through this so a key supplied via PAUBOX_API_KEY is never
 * persisted to disk as a side effect of `auth set-forms-key`.
 */
export async function loadStoredCredentials(): Promise<PauboxCredentials | null> {
  const keytar = keychain();
  if (keytar) {
    try {
      const raw = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (raw) {
        try {
          return JSON.parse(raw) as PauboxCredentials;
        } catch {
          return null;
        }
      }
      // Nothing in the keychain: credentials saved while the keychain was
      // unreachable live in the config file, so look there before giving up.
    } catch (err) {
      markKeychainFailed(err);
    }
  }
  return configStore.getCredentials();
}

/**
 * Credentials for making requests. PAUBOX_API_KEY and PAUBOX_FORMS_API_KEY
 * each override the matching stored key; a key not set in the environment
 * still comes from the store.
 */
export async function loadCredentials(): Promise<PauboxCredentials | null> {
  const env = envCredentials();
  const stored = env.apiKey && env.formsApiKey ? null : await loadStoredCredentials();
  if (!env.apiKey && !env.formsApiKey) return stored;

  const formsApiKey = env.formsApiKey ?? stored?.formsApiKey;
  return {
    apiKey: env.apiKey ?? stored?.apiKey ?? '',
    ...(formsApiKey ? { formsApiKey } : {}),
  };
}

export async function clearCredentials(): Promise<void> {
  const keytar = keychain();
  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    } catch (err) {
      markKeychainFailed(err);
    }
  }
  // Always clear the file too: it holds anything saved while the keychain was
  // unreachable, and logout should leave nothing behind in either place.
  if (configStore.getCredentials()) configStore.clearCredentials();
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '****';
  return '****' + apiKey.slice(-4);
}

/** True when the OS keychain is installed and has not failed in this process. */
export function usingKeychain(): boolean {
  return keychain() !== null;
}

/** The keychain's error message, if keytar is installed but failed to work. */
export function keychainUnavailableReason(): string | null {
  return keychainError;
}
