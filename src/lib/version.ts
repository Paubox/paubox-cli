import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Read the package version at runtime.
 *
 * This module compiles to `dist/lib/version.js` and lives at `src/lib/version.ts`
 * in dev, so the package root is two levels up in both layouts.
 */
export function readPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    // A missing or unreadable package.json must not stop the CLI from running —
    // the version is only ever used for display and for the User-Agent.
    return '0.0.0';
  }
}
