/** An error that is safe to show to API clients. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do that') => new AppError(403, 'FORBIDDEN', msg);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', msg);
export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details);

/** Postgres error codes we treat as retryable transaction conflicts. */
export const RETRYABLE_PG_CODES = new Set(['40001', '40P01']);

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}
