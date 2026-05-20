export class PauboxError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'PauboxError';
  }
}

export class AuthError extends PauboxError {
  constructor(message: string, suggestion?: string) {
    super(message, 1, suggestion ?? 'Run `paubox auth login` to authenticate.');
    this.name = 'AuthError';
  }
}

export class ApiError extends PauboxError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    suggestion?: string,
  ) {
    super(message, 1, suggestion);
    this.name = 'ApiError';
  }
}

export class ConfigError extends PauboxError {
  constructor(message: string, suggestion?: string) {
    super(message, 1, suggestion);
    this.name = 'ConfigError';
  }
}
