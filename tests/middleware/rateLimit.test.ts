import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../../src/middleware/rateLimit.js';
import type { ApiKey } from '../../src/types/index.js';

describe('RateLimiter - Token Bucket', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
  });

  // Helper to create mock context
  const createMockContext = (apiKey: ApiKey) => {
    const headers: Record<string, string> = {};
    let responseStatus = 200;
    let responseBody: any = null;

    return {
      req: { header: () => undefined },
      get: (key: string) => key === 'apiKey' ? apiKey : undefined,
      set: () => {},
      header: (key: string, value: string) => { headers[key] = value; },
      json: (body: any, status?: number) => {
        responseBody = body;
        if (status) responseStatus = status;
        return { status: responseStatus, body: responseBody };
      },
      getHeaders: () => headers,
      getStatus: () => responseStatus,
      getBody: () => responseBody
    };
  };

  const mockNext = async () => {};

  describe('Token consumption', () => {
    it('should allow requests when tokens available', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-1',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 60,
          burstAllowance: 10
        },
        createdAt: new Date().toISOString()
      };

      const ctx = createMockContext(apiKey) as any;
      const middleware = rateLimiter.middleware();

      await middleware(ctx, mockNext);

      expect(ctx.getHeaders()['X-RateLimit-Limit']).toBe('10');
      expect(parseInt(ctx.getHeaders()['X-RateLimit-Remaining'])).toBeGreaterThanOrEqual(0);
      expect(ctx.getStatus()).toBe(200);
    });

    it('should consume tokens on each request', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-2',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 60,
          burstAllowance: 5
        },
        createdAt: new Date().toISOString()
      };

      const middleware = rateLimiter.middleware();

      // Make 5 requests (exhaust burst)
      for (let i = 0; i < 5; i++) {
        const ctx = createMockContext(apiKey) as any;
        await middleware(ctx, mockNext);
        expect(ctx.getStatus()).toBe(200);
      }

      // 6th request should fail
      const ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getStatus()).toBe(429);
      expect(ctx.getBody().error).toBe('Rate limit exceeded');
      expect(ctx.getBody().code).toBe('rate_limit_exceeded');
      expect(ctx.getBody().retryAfter).toBeGreaterThan(0);
      expect(ctx.getBody().limit).toBe(5);
      expect(ctx.getBody().remaining).toBe(0);
    });
  });

  describe('Burst allowance', () => {
    it('should allow burst of requests up to capacity', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-3',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 6, // 0.1 tokens/sec
          burstAllowance: 3
        },
        createdAt: new Date().toISOString()
      };

      const middleware = rateLimiter.middleware();

      // Should allow 3 rapid requests
      for (let i = 0; i < 3; i++) {
        const ctx = createMockContext(apiKey) as any;
        await middleware(ctx, mockNext);
        expect(ctx.getStatus()).toBe(200);
      }

      // 4th immediate request should fail
      const ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getStatus()).toBe(429);
    });
  });

  describe('Token refill', () => {
    it('should refill tokens over time', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-4',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 60, // 1 token/sec
          burstAllowance: 2
        },
        createdAt: new Date().toISOString()
      };

      const middleware = rateLimiter.middleware();

      // Exhaust tokens
      for (let i = 0; i < 2; i++) {
        const ctx = createMockContext(apiKey) as any;
        await middleware(ctx, mockNext);
        expect(ctx.getStatus()).toBe(200);
      }

      // Immediate request should fail
      let ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getStatus()).toBe(429);

      // Wait 1.1 seconds for refill (1 token)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should succeed now
      ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getStatus()).toBe(200);
    }, 3000); // Increase timeout for async test
  });

  describe('HTTP headers', () => {
    it('should include rate limit headers on success', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-5',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 60,
          burstAllowance: 10
        },
        createdAt: new Date().toISOString()
      };

      const ctx = createMockContext(apiKey) as any;
      const middleware = rateLimiter.middleware();

      await middleware(ctx, mockNext);

      const headers = ctx.getHeaders();
      expect(headers['X-RateLimit-Limit']).toBeDefined();
      expect(headers['X-RateLimit-Remaining']).toBeDefined();
    });

    it('should include retry headers on rate limit', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-6',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 6,
          burstAllowance: 1
        },
        createdAt: new Date().toISOString()
      };

      const middleware = rateLimiter.middleware();

      // Exhaust token
      let ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);

      // Rate limited request
      ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);

      const headers = ctx.getHeaders();
      expect(headers['Retry-After']).toBeDefined();
      expect(headers['X-RateLimit-Remaining']).toBe('0');
      expect(ctx.getBody().retryAfter).toBeGreaterThan(0);
    });
  });

  describe('Backward compatibility', () => {
    it('should work with old rateLimit field', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-7',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimit: 60, // Old format
        createdAt: new Date().toISOString()
      };

      const ctx = createMockContext(apiKey) as any;
      const middleware = rateLimiter.middleware();

      await middleware(ctx, mockNext);
      expect(ctx.getStatus()).toBe(200);
    });
  });

  describe('Utility methods', () => {
    it('should return bucket status', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-8',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 60,
          burstAllowance: 10
        },
        createdAt: new Date().toISOString()
      };

      const ctx = createMockContext(apiKey) as any;
      const middleware = rateLimiter.middleware();

      await middleware(ctx, mockNext);

      const status = rateLimiter.getStatus('test-key-8');
      expect(status).toBeDefined();
      expect(status?.capacity).toBe(10);
      expect(status?.tokens).toBeLessThanOrEqual(10);
    });

    it('should reset bucket', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-9',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 60,
          burstAllowance: 2
        },
        createdAt: new Date().toISOString()
      };

      const middleware = rateLimiter.middleware();

      // Exhaust tokens
      for (let i = 0; i < 2; i++) {
        const ctx = createMockContext(apiKey) as any;
        await middleware(ctx, mockNext);
      }

      // Should fail
      let ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getStatus()).toBe(429);

      // Reset bucket
      rateLimiter.resetBucket('test-key-9');

      // Should succeed now
      ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getStatus()).toBe(200);
    });
  });

  describe('Config changes', () => {
    it('should apply updated rate limit config for an existing key bucket', async () => {
      const apiKey: ApiKey = {
        id: 'test-key-config-refresh',
        name: 'Test',
        key: 'sk-test',
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 60,
          burstAllowance: 5
        },
        createdAt: new Date().toISOString()
      };

      const middleware = rateLimiter.middleware();

      let ctx = createMockContext(apiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getHeaders()['X-RateLimit-Limit']).toBe('5');
      expect(ctx.getStatus()).toBe(200);

      const updatedApiKey: ApiKey = {
        ...apiKey,
        rateLimitConfig: {
          requestsPerMinute: 60,
          burstAllowance: 1
        }
      };

      ctx = createMockContext(updatedApiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getHeaders()['X-RateLimit-Limit']).toBe('1');
      expect(ctx.getStatus()).toBe(200);

      ctx = createMockContext(updatedApiKey) as any;
      await middleware(ctx, mockNext);
      expect(ctx.getStatus()).toBe(429);
      expect(ctx.getBody().limit).toBe(1);
    });
  });
});
