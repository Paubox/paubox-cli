import { readFileSync } from 'fs';
import { join } from 'path';
import { createProgram } from '../src/index';

describe('paubox --version', () => {
  it('reports the version declared in package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { version: string };

    expect(createProgram().version()).toBe(pkg.version);
  });
});
