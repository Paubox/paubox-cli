/**
 * Error taxonomy for the CLI.
 *
 * Every failure the user can hit is one of six kinds, and each kind has its own
 * exit code so a shell script can branch on *why* a command failed rather than
 * scraping stderr. The codes are part of the CLI's contract — changing one is a
 * breaking change.
 */
export const ExitCode = {
  GENERAL: 1,
  AUTH: 2,
  VALIDATION: 3,
  API: 4,
  NETWORK: 5,
  CONFIG: 6,
} as const;

export type ErrorKind = 'general' | 'auth' | 'validation' | 'api' | 'network' | 'config';

/** The shape written to stderr under `--json`. snake_case to match the APIs. */
export interface ErrorJson {
  error: {
    type: ErrorKind;
    message: string;
    status?: number;
    request_id?: string;
    suggestion?: string;
    /** Present on validation errors: one entry per failed field. */
    problems?: string[];
  };
}

export class PauboxError extends Error {
  readonly kind: ErrorKind = 'general';

  /**
   * The `X-Request-Id` the CLI sent with the failing request. Set by the HTTP
   * layer after construction, because the id belongs to the request rather than
   * to the error, and errors are also raised before any request is made.
   */
  requestId?: string;

  constructor(
    message: string,
    public readonly exitCode: number = ExitCode.GENERAL,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'PauboxError';
  }

  /** Status code, when the error came from an HTTP response. */
  get statusCode(): number | undefined {
    return undefined;
  }

  toJson(): ErrorJson {
    return {
      error: {
        type: this.kind,
        message: this.message,
        ...(this.statusCode !== undefined ? { status: this.statusCode } : {}),
        ...(this.requestId ? { request_id: this.requestId } : {}),
        ...(this.suggestion ? { suggestion: this.suggestion } : {}),
      },
    };
  }
}

/**
 * Authentication and authorization failures.
 *
 * Kept as one class with three factories rather than three classes: callers
 * only ever branch on `kind`, and the distinction that matters to the user is
 * the suggestion, not the type.
 */
export class AuthError extends PauboxError {
  readonly kind: ErrorKind = 'auth';

  constructor(
    message: string,
    suggestion?: string,
    private readonly status?: number,
  ) {
    super(message, ExitCode.AUTH, suggestion ?? 'Run `paubox auth login` to authenticate.');
    this.name = 'AuthError';
  }

  get statusCode(): number | undefined {
    return this.status;
  }

  /** No credential is stored at all. */
  static missing(what: 'email' | 'forms'): AuthError {
    return what === 'email'
      ? new AuthError(
          'No Paubox API key is stored.',
          'Run `paubox auth login` and paste an Email API key from the Paubox dashboard.',
        )
      : new AuthError(
          'No Forms API key is stored.',
          'Run `paubox auth set-forms-key` with a scoped API key that carries the "forms" scope.',
        );
  }

  /**
   * A credential was sent and rejected (401). The two key types are not
   * interchangeable and look identical in `auth status`, so name the mismatch
   * explicitly — it is the most common cause of a 401 here.
   */
  static invalid(what: 'email' | 'forms' | 'webhooks'): AuthError {
    if (what === 'webhooks') {
      // Webhooks accepts either key: the Forms key when one is stored,
      // otherwise the Email API key. Name both so the user checks the right one.
      return new AuthError(
        'The API key used for webhooks was rejected.',
        'Webhooks uses your Forms key if one is stored, otherwise your Email API key. ' +
          'Check both with `paubox auth status`, then re-run `paubox auth set-forms-key` or `paubox auth login`.',
        401,
      );
    }
    return what === 'email'
      ? new AuthError(
          'The Paubox API key was rejected.',
          'Confirm the key with `paubox auth status`, then re-run `paubox auth login`. ' +
            'Note this endpoint needs an Email API key, not a scoped key from `auth set-forms-key`.',
          401,
        )
      : new AuthError(
          'The Forms API key was rejected.',
          'Re-run `paubox auth set-forms-key` with a scoped key that has the "forms" scope. ' +
            'Note this endpoint needs a scoped key, not the Email API key from `auth login`.',
          401,
        );
  }

  /** The credential is valid but not entitled to this operation (403). */
  static forbidden(message: string, suggestion?: string): AuthError {
    return new AuthError(
      message,
      suggestion ??
        'The key authenticated but is not scoped for this operation. ' +
          'Check its scopes in the Paubox dashboard under API keys.',
      403,
    );
  }
}

export class ApiError extends PauboxError {
  readonly kind: ErrorKind = 'api';

  constructor(
    message: string,
    private readonly status?: number,
    suggestion?: string,
  ) {
    super(message, ExitCode.API, suggestion);
    this.name = 'ApiError';
  }

  get statusCode(): number | undefined {
    return this.status;
  }
}

export class ConfigError extends PauboxError {
  readonly kind: ErrorKind = 'config';

  constructor(message: string, suggestion?: string) {
    super(message, ExitCode.CONFIG, suggestion);
    this.name = 'ConfigError';
  }
}

/**
 * The request was rejected locally, before any network call.
 *
 * Separate from ConfigError so a script can tell "you gave me a bad address"
 * (fix the arguments) from "this machine is not set up" (fix the install).
 */
export class ValidationError extends PauboxError {
  readonly kind: ErrorKind = 'validation';

  constructor(
    message: string,
    suggestion?: string,
    /** One entry per failed field, in the order they were checked. */
    public readonly problems: string[] = [],
  ) {
    super(message, ExitCode.VALIDATION, suggestion);
    this.name = 'ValidationError';
  }

  toJson(): ErrorJson {
    const json = super.toJson();
    return this.problems.length > 0
      ? { error: { ...json.error, problems: this.problems } }
      : json;
  }
}

/**
 * The request never reached Paubox: DNS, TCP, TLS or a timeout.
 *
 * Distinguished from ApiError because the remedy is entirely different — there
 * is nothing wrong with the request, and retrying it unchanged is reasonable.
 */
export class NetworkError extends PauboxError {
  readonly kind: ErrorKind = 'network';

  constructor(
    message: string,
    suggestion?: string,
    /** The underlying libc/undici code, e.g. ENOTFOUND, ECONNREFUSED. */
    public readonly code?: string,
  ) {
    super(message, ExitCode.NETWORK, suggestion);
    this.name = 'NetworkError';
  }
}
