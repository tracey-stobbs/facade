export enum ErrorCodes {
  JOBSTORE_NOT_INITIALISED = 'JOBSTORE_NOT_INITIALISED',
}

export class AppError extends Error {
  code: ErrorCodes | string;
  details?: unknown;
  constructor(code: ErrorCodes | string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
