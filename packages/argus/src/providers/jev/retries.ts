export const DEFAULT_RETRIES = 3;
export const MAX_RETRIES = 10;
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const BACKOFF_FACTOR = 2;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 529]);

export type RetryNotice = { reason: string; retry: number; retries: number; delayMs: number };

export class RequestFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

export function httpFailure(response: Response, now: number): RequestFailure {
  const header = response.headers.get("retry-after");
  const seconds = header?.trim() ? Number(header) : Number.NaN;
  const delay = Number.isFinite(seconds) ? seconds * INITIAL_DELAY_MS : Date.parse(header ?? "") - now;
  return new RequestFailure(
    `TypeSafe HTTP ${response.status}`,
    RETRYABLE_STATUSES.has(response.status),
    Number.isFinite(delay) ? Math.max(0, delay) : 0,
  );
}

export function retryDelay(attempt: number, failure: RequestFailure): number {
  return Math.max(failure.retryAfterMs, Math.min(MAX_DELAY_MS, INITIAL_DELAY_MS * BACKOFF_FACTOR ** attempt));
}
