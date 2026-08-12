import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeExportFile } from '../../src/lib/file-write';
import { ConfigError } from '../../src/lib/errors';

const itUnix = process.platform === 'win32' ? it.skip : it;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-file-write-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeExportFile', () => {
  it('creates a new file with the exact byte payload', () => {
    const dest = path.join(tmpDir, 'export.csv');
    const payload = Buffer.from('col1,col2\n1,2\n', 'utf8');

    writeExportFile(dest, payload, false);

    expect(fs.readFileSync(dest)).toEqual(payload);
  });

  itUnix('writes files with mode 0o600 (owner-only rw)', () => {
    const dest = path.join(tmpDir, 'export.csv');
    writeExportFile(dest, Buffer.from('x'), false);

    const stat = fs.statSync(dest);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('refuses to overwrite an existing file without --force', () => {
    const dest = path.join(tmpDir, 'export.csv');
    fs.writeFileSync(dest, 'pre-existing');

    expect(() => writeExportFile(dest, Buffer.from('replacement'), false)).toThrow(
      ConfigError,
    );
    expect(fs.readFileSync(dest, 'utf8')).toBe('pre-existing');
  });

  it('overwrites an existing plain file when --force is passed', () => {
    const dest = path.join(tmpDir, 'export.csv');
    fs.writeFileSync(dest, 'pre-existing');

    writeExportFile(dest, Buffer.from('replacement'), true);

    expect(fs.readFileSync(dest, 'utf8')).toBe('replacement');
  });

  itUnix('refuses a symlinked destination without --force', () => {
    const target = path.join(tmpDir, 'target.txt');
    const link = path.join(tmpDir, 'export.csv');
    fs.writeFileSync(target, 'target-body');
    fs.symlinkSync(target, link);

    expect(() => writeExportFile(link, Buffer.from('payload'), false)).toThrow(
      /symlinked destination/,
    );
    expect(fs.readFileSync(target, 'utf8')).toBe('target-body');
  });

  itUnix('refuses a symlinked destination even when --force is passed', () => {
    const target = path.join(tmpDir, 'target.txt');
    const link = path.join(tmpDir, 'export.csv');
    fs.writeFileSync(target, 'target-body');
    fs.symlinkSync(target, link);

    expect(() => writeExportFile(link, Buffer.from('payload'), true)).toThrow(
      /symlinked destination/,
    );
    expect(fs.readFileSync(target, 'utf8')).toBe('target-body');
  });

  itUnix('refuses a dangling symlink destination even when --force is passed', () => {
    const link = path.join(tmpDir, 'export.csv');
    fs.symlinkSync(path.join(tmpDir, 'does-not-exist'), link);

    expect(() => writeExportFile(link, Buffer.from('payload'), true)).toThrow(
      /symlinked destination/,
    );
    expect(fs.existsSync(path.join(tmpDir, 'does-not-exist'))).toBe(false);
  });

  itUnix('overwriting with --force replaces the inode (no in-place write into a hostile target)', () => {
    const dest = path.join(tmpDir, 'export.csv');
    fs.writeFileSync(dest, 'pre-existing');
    const originalIno = fs.statSync(dest).ino;

    writeExportFile(dest, Buffer.from('replacement'), true);

    const newIno = fs.statSync(dest).ino;
    expect(newIno).not.toBe(originalIno);
    expect(fs.statSync(dest).mode & 0o777).toBe(0o600);
  });
});
