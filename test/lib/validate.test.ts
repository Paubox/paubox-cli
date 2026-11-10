import { ExitCode, ValidationError } from '../../src/lib/errors';
import {
  extractAddress,
  isValidEmail,
  validateMessage,
  validateScheduledAt,
} from '../../src/lib/validate';

describe('isValidEmail', () => {
  it.each(['a@b.co', 'first.last+tag@sub.example.com', 'Jane Doe <jane@example.com>'])(
    'accepts %s',
    (value) => {
      expect(isValidEmail(value)).toBe(true);
    },
  );

  it.each(['', 'nope', 'nope@', '@example.com', 'a@b', 'a b@example.com', 'a@b,c.com'])(
    'rejects %s',
    (value) => {
      expect(isValidEmail(value)).toBe(false);
    },
  );

  it('pulls the address out of a display-name form', () => {
    expect(extractAddress('Jane Doe <jane@example.com>')).toBe('jane@example.com');
  });
});

describe('validateMessage', () => {
  const valid = {
    to: ['to@example.com'],
    from: 'from@example.com',
    subject: 'Hello',
    text: 'body',
  };

  it('accepts a well-formed message', () => {
    expect(() => validateMessage(valid)).not.toThrow();
  });

  it('names the offending recipient', () => {
    expect(() => validateMessage({ ...valid, to: ['good@example.com', 'bad@'] })).toThrow(
      /--to: "bad@" is not a valid email address/,
    );
  });

  it('requires a body', () => {
    expect(() => validateMessage({ ...valid, text: undefined })).toThrow(/--text\/--html/);
  });

  it('rejects an empty subject', () => {
    expect(() => validateMessage({ ...valid, subject: '   ' })).toThrow(/--subject/);
  });

  // Reporting one problem per run makes fixing a malformed command an
  // arbitrarily long loop; collect them all instead.
  it('collects every problem in one pass', () => {
    try {
      validateMessage({ to: ['bad@'], from: 'alsobad', subject: '', text: undefined });
      throw new Error('expected validateMessage to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const problems = (err as ValidationError).problems;
      expect(problems).toHaveLength(4);
      expect(problems.join('\n')).toContain('--from');
      expect((err as ValidationError).exitCode).toBe(ExitCode.VALIDATION);
    }
  });

  it('rejects attachments over the request limit', () => {
    const attachments = [
      { fileName: 'big.bin', contentType: 'application/octet-stream', content: 'x'.repeat(260 * 1024 * 1024) },
    ];
    expect(() => validateMessage({ ...valid, attachments })).toThrow(/over the 250 MB request limit/);
  });

  it('says nothing was sent, so the user knows the state', () => {
    expect(() => validateMessage({ ...valid, to: ['bad@'] })).toThrow(
      expect.objectContaining({ suggestion: expect.stringContaining('Nothing was sent') }),
    );
  });
});

describe('validateScheduledAt', () => {
  it('accepts a future ISO 8601 timestamp', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(() => validateScheduledAt(future)).not.toThrow();
  });

  it('rejects an unparseable value', () => {
    expect(() => validateScheduledAt('next tuesday')).toThrow(/not a valid timestamp/);
  });

  it('rejects a time in the past', () => {
    expect(() => validateScheduledAt('2020-01-01T00:00:00Z')).toThrow(/in the past/);
  });
});
