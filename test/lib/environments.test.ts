import { ENVIRONMENTS, resolveEnvironment } from '../../src/lib/environments';
import { ConfigError } from '../../src/lib/errors';

describe('resolveEnvironment', () => {
  it('defaults to production', () => {
    expect(resolveEnvironment({}, {})).toEqual({ name: 'production', ...ENVIRONMENTS.production });
  });

  it('selects staging by flag or PAUBOX_ENV', () => {
    expect(resolveEnvironment({ env: 'staging' }, {})).toEqual({ name: 'staging', ...ENVIRONMENTS.staging });
    expect(resolveEnvironment({}, { PAUBOX_ENV: 'Staging' }).name).toBe('staging');
  });

  it('lets the flag win over PAUBOX_ENV', () => {
    expect(resolveEnvironment({ env: 'production' }, { PAUBOX_ENV: 'staging' }).name).toBe('production');
  });

  it('marks an overridden URL as custom and keeps the other default', () => {
    const resolved = resolveEnvironment({ env: 'staging', webUrl: 'https://local.paubox.net/' }, {});
    expect(resolved).toEqual({
      name: 'custom',
      webUrl: 'https://local.paubox.net',
      iamUrl: ENVIRONMENTS.staging.iamUrl,
    });
  });

  it('reads URL overrides from the environment', () => {
    const resolved = resolveEnvironment({}, { PAUBOX_IAM_URL: 'https://iam.example.test/iam/' });
    expect(resolved.iamUrl).toBe('https://iam.example.test/iam');
    expect(resolved.name).toBe('custom');
  });

  it('rejects an unknown environment', () => {
    expect(() => resolveEnvironment({ env: 'qa' }, {})).toThrow(ConfigError);
  });

  it('rejects a URL that is not http(s)', () => {
    expect(() => resolveEnvironment({ webUrl: 'ftp://x' }, {})).toThrow(ConfigError);
    expect(() => resolveEnvironment({ webUrl: 'not a url' }, {})).toThrow(ConfigError);
  });
});
