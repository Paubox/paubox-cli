import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ConfigData } from '../types';

interface StorageFile {
  credentials?: {
    apiUsername: string;
    apiKey: string;
  };
  config?: ConfigData;
}

let configDirOverride: string | undefined;

export function setConfigDir(dir: string): void {
  configDirOverride = dir;
}

export function getConfigDir(): string {
  return configDirOverride ?? path.join(os.homedir(), '.config', 'paubox');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

function readFile(): StorageFile {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as StorageFile;
  } catch {
    return {};
  }
}

function writeFile(data: StorageFile): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = getConfigPath();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function getCredentials(): { apiUsername: string; apiKey: string } | null {
  const data = readFile();
  return data.credentials ?? null;
}

export function saveCredentials(apiUsername: string, apiKey: string): void {
  const data = readFile();
  data.credentials = { apiUsername, apiKey };
  writeFile(data);
}

export function clearCredentials(): void {
  const data = readFile();
  delete data.credentials;
  writeFile(data);
}

export function getConfig(): ConfigData {
  return readFile().config ?? {};
}

export function getConfigValue(key: string): string | undefined {
  return getConfig()[key];
}

export function setConfigValue(key: string, value: string): void {
  const data = readFile();
  data.config = { ...data.config, [key]: value };
  writeFile(data);
}

export function listConfig(): ConfigData {
  return getConfig();
}

export function resetConfig(): void {
  const data = readFile();
  data.config = {};
  writeFile(data);
}
