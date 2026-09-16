import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Small in-memory failure limiter for sensitive endpoints (gateway code, MFA).
 * Single-process only — move to Redis when the API is scaled horizontally (Phase 3).
 */
export class FailureLimiter {
  private failures = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  assertAllowed(key: string) {
    const entry = this.failures.get(key);
    if (!entry) return;
    if (Date.now() - entry.firstAt > this.windowMs) {
      this.failures.delete(key);
      return;
    }
    if (entry.count >= this.maxFailures) {
      throw new HttpException(
        { message: 'Too many failed attempts. Try again later.', code: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  fail(key: string) {
    const entry = this.failures.get(key);
    if (!entry || Date.now() - entry.firstAt > this.windowMs) {
      this.failures.set(key, { count: 1, firstAt: Date.now() });
    } else {
      entry.count++;
    }
  }

  reset(key: string) {
    this.failures.delete(key);
  }
}
