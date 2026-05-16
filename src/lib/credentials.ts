import * as configStore from './config-store';
import type { PauboxCredentials } from '../types';

const KEYCHAIN_SERVICE = 'paubox-cli';
const KEYCHAIN_ACCOUNT = 'default';

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

export async function saveCredentials(creds: PauboxCredentials): Promise<void> {
  const keytar = loadKeytar();
  if (keytar) {
    await keytar.setPassword(
      KEYCHAIN_SERVICE,
      KEYCHAIN_ACCOUNT,
      JSON.stringify(creds),
    );
    return;
  }
  configStore.saveCredentials(creds.apiUsername, creds.apiKey);
}

export async function loadCredentials(): Promise<PauboxCredentials | null> {
  const keytar = loadKeytar();
  if (keytar) {
    const raw = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (raw) {
      try {
        return JSON.parse(raw) as PauboxCredentials;
      } catch {
        return null;
      }
    }
    return null;
  }
  return configStore.getCredentials();
}

export async function clearCredentials(): Promise<void> {
  const keytar = loadKeytar();
  if (keytar) {
    await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    return;
  }
  configStore.clearCredentials();
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '****';
  return '****' + apiKey.slice(-4);
}

export function usingKeychain(): boolean {
  return loadKeytar() !== null;
}
