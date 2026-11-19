/** Human-readable explanations for server codes. Wording only; the code always comes from the backend. */
export const REJECT_REASONS: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Not enough buying power for this order. Resting buy orders reserve cash until they fill or are cancelled.',
  INSUFFICIENT_SHARES: 'You don’t have enough available shares. Shares on resting sell orders are reserved. (Short selling is disabled — the tagline is a joke.)',
  MARKET_HALTED: 'The whole exchange is halted. No orders are accepted until an admin resumes trading.',
  SYMBOL_HALTED: 'Trading in this security is halted by an admin.',
  STATUS_UNVERIFIED: 'This security’s listing status hasn’t been verified from the original document, so it can’t trade yet.',
  REFERENCE_PRICE_UNVERIFIED: 'This security has no verified reference price yet, so it can’t trade.',
  SECURITY_SUSPENDED: 'This security is suspended under its original listing restrictions.',
  SECURITY_UNLISTED: 'This security is unlisted and cannot be traded.',
  SECURITY_LISTING_HALTED: 'This security’s original listing status is HALTED.',
  INVALID_ORDER: 'The order was invalid.',
  NO_LIQUIDITY: 'There was no opposing liquidity on the book.',
};

export const CANCEL_REASONS: Record<string, string> = {
  NO_LIQUIDITY: 'Market order remainder cancelled: no more opposing orders on the book.',
  MAX_SPEND_REACHED: 'Market buy stopped at your spending cap; the remainder was cancelled.',
  SELF_TRADE_PREVENTION: 'Stopped before matching your own resting order (self-trade prevention). The remainder was cancelled.',
  USER_REQUESTED: 'Cancelled by you.',
  ADMIN_CANCELLED: 'Cancelled by an administrator.',
  ACCOUNT_DISABLED: 'Cancelled because the account was disabled.',
  MARKET_RESET: 'Cancelled by a simulation reset.',
};

export const BLOCK_LABEL: Record<string, string> = {
  MARKET_HALTED: 'Market halted',
  STATUS_UNVERIFIED: 'Unverified',
  SECURITY_SUSPENDED: 'Suspended',
  SECURITY_UNLISTED: 'Unlisted',
  SECURITY_LISTING_HALTED: 'Listing halted',
  REFERENCE_PRICE_UNVERIFIED: 'No verified price',
  SYMBOL_HALTED: 'Halted',
};

export const API_ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect username or password.',
  USERNAME_TAKEN: 'That username is already taken.',
  RATE_LIMITED: 'Slow down — too many requests. Try again in a moment.',
  ORDER_NOT_OPEN: 'That order is no longer open (it may have just filled).',
  IDEMPOTENCY_KEY_REUSED: 'This order was already submitted with different details. Please start a new order.',
  IDEMPOTENCY_IN_PROGRESS: 'This order is still being processed. Please wait a moment.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You don’t have permission to do that.',
  ORIGIN_NOT_ALLOWED: 'This site origin is not allowed by the server.',
  WATCHLIST_FULL: 'Your watchlist is full.',
};

export function rejectMessage(code: string | null | undefined): string {
  if (!code) return 'The order was rejected.';
  return REJECT_REASONS[code] ?? `Rejected: ${code.replaceAll('_', ' ').toLowerCase()}.`;
}

export function cancelMessage(code: string | null | undefined): string {
  if (!code) return 'Cancelled.';
  return CANCEL_REASONS[code] ?? `Cancelled: ${code.replaceAll('_', ' ').toLowerCase()}.`;
}
