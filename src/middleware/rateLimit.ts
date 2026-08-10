import type { Context, Next } from 'hono';
import type { ApiKey } from '../types/index.js';
import { errorResponse } from '../lib/errors.js';

/**
 * Token Bucket Rate Limiter
 * 
 * Algorithm:
 * - Each client has a bucket with a max capacity (burst allowance)
 * - Tokens are added at a fixed rate (refill rate)
 * - Each request consumes 1 token
 * - If no tokens available, request is denied
 */

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per millisecond
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();

  /**
   * Get or create token bucket for a client
   */
  private getBucket(apiKey: ApiKey): TokenBucket {
    const keyId = apiKey.id;
    
    // Get rate limit config (new format or fallback to old)
    const rateLimitConfig = apiKey.rateLimitConfig || {
      requestsPerMinute: apiKey.rateLimit || 60,
      burstAllowance: 10
    };

    const capacity = rateLimitConfig.burstAllowance;
    const refillRate = rateLimitConfig.requestsPerMinute / 60000; // tokens per ms

    let bucket = this.buckets.get(keyId);

    if (bucket && (bucket.capacity !== capacity || bucket.refillRate !== refillRate)) {
      this.refillBucket(bucket);
      bucket.capacity = capacity;
      bucket.refillRate = refillRate;
      bucket.tokens = Math.min(bucket.tokens, capacity);
    }

    if (!bucket) {
      // Create new bucket, start full
      bucket = {
        tokens: capacity,
        lastRefill: Date.now(),
        capacity,
        refillRate
      };
      this.buckets.set(keyId, bucket);
    }

    return bucket;
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = elapsed * bucket.refillRate;

    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Try to consume a token
   * Returns true if successful, false if rate limited
   */
  private consumeToken(bucket: TokenBucket): boolean {
    this.refillBucket(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Calculate retry-after time in seconds
   */
  private getRetryAfter(bucket: TokenBucket): number {
    // Time needed to refill 1 token
    const msPerToken = 1 / bucket.refillRate;
    return Math.ceil(msPerToken / 1000);
  }

  middleware() {
    return async (c: Context, next: Next) => {
      const apiKey: ApiKey | undefined = c.get('apiKey');
      if (!apiKey) return next();

      const bucket = this.getBucket(apiKey);
      const allowed = this.consumeToken(bucket);

      if (!allowed) {
        const retryAfter = this.getRetryAfter(bucket);
        
        c.header('Retry-After', String(retryAfter));
        c.header('X-RateLimit-Limit', String(bucket.capacity));
        c.header('X-RateLimit-Remaining', '0');
        c.header('X-RateLimit-Reset', String(Math.ceil((Date.now() + (retryAfter * 1000)) / 1000)));
        
        return errorResponse(c, 429, 'rate_limit_exceeded', 'Rate limit exceeded', {
          retryAfter,
          limit: bucket.capacity,
          remaining: 0
        });
      }

      // Success - add rate limit headers
      c.header('X-RateLimit-Limit', String(bucket.capacity));
      c.header('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
      
      await next();
    };
  }

  /**
   * Get current bucket status for a key (useful for admin/debugging)
   */
  getStatus(keyId: string): { tokens: number; capacity: number } | null {
    const bucket = this.buckets.get(keyId);
    if (!bucket) return null;

    this.refillBucket(bucket);
    return {
      tokens: Math.floor(bucket.tokens),
      capacity: bucket.capacity
    };
  }

  /**
   * Reset bucket for a key (useful for testing)
   */
  resetBucket(keyId: string): void {
    this.buckets.delete(keyId);
  }

  /**
   * Clear all buckets (useful for testing)
   */
  clearAll(): void {
    this.buckets.clear();
  }
}
