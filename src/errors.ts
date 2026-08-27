export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export class AuthenticationError extends CliError {
  constructor(message: string) {
    super(message, 3);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends CliError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'ValidationError';
  }
}
