import * as fs from 'fs';
import * as path from 'path';
import { ConfigError } from './errors';

export function writeExportFile(outputPath: string, data: Buffer, force: boolean): void {
  const resolved = path.resolve(outputPath);

  let existingStat: fs.Stats | null = null;
  try {
    existingStat = fs.lstatSync(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (existingStat?.isSymbolicLink()) {
    throw new ConfigError(
      `Refusing to write to symlinked destination: ${outputPath}`,
      'Choose a plain-file path or remove the symlink first.',
    );
  }

  if (existingStat?.isDirectory()) {
    throw new ConfigError(
      `--output points to a directory: ${outputPath}`,
      'Pass a file path instead.',
    );
  }

  if (existingStat && !force) {
    throw new ConfigError(
      `File already exists: ${outputPath}`,
      'Pass --force to overwrite, or choose a different --output path.',
    );
  }

  if (existingStat && force) {
    fs.unlinkSync(resolved);
  }

  fs.writeFileSync(resolved, data, { mode: 0o600, flag: 'wx' });
}
