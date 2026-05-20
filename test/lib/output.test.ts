import chalk from 'chalk';
import * as output from '../../src/lib/output';

beforeEach(() => {
  // Disable chalk colors for stable string matching in tests
  chalk.level = 0;
});

describe('printSuccess', () => {
  it('writes colored message to stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printSuccess('All good');
    expect(spy.mock.calls[0][0]).toContain('All good');
    spy.mockRestore();
  });

  it('suppresses output when quiet', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printSuccess('silent', { quiet: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('suppresses output when json', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printSuccess('silent', { json: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('printInfo', () => {
  it('writes message to stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printInfo('hello');
    expect(spy.mock.calls[0][0]).toContain('hello');
    spy.mockRestore();
  });

  it('suppresses when quiet', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printInfo('quiet', { quiet: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('suppresses when json', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printInfo('json', { json: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('printJson', () => {
  it('writes JSON to stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printJson({ key: 'value' });
    const written = spy.mock.calls[0][0] as string;
    expect(JSON.parse(written)).toEqual({ key: 'value' });
    spy.mockRestore();
  });
});

describe('printError', () => {
  it('writes to stderr', () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    output.printError('bad thing happened');
    expect(spy.mock.calls[0][0]).toContain('bad thing happened');
    spy.mockRestore();
  });

  it('writes suggestion when provided', () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    output.printError('bad thing', 'try this instead');
    const written = spy.mock.calls.map((c) => c[0] as string).join('');
    expect(written).toContain('try this instead');
    spy.mockRestore();
  });

  it('does not write suggestion when omitted', () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    output.printError('bad thing');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('printTable', () => {
  it('prints header and rows', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printTable([{ name: 'Alice', role: 'admin' }]);
    const written = spy.mock.calls.map((c) => c[0] as string).join('');
    expect(written).toContain('name');
    expect(written).toContain('Alice');
    spy.mockRestore();
  });

  it('does nothing for empty array', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    output.printTable([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
