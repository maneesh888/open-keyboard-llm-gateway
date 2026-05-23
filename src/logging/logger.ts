import type { Context, Next } from 'hono';
import type { RequestLog } from '../types/index.js';

export function loggingMiddleware() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;

    const apiKey = c.get('apiKey');
    const log: RequestLog = {
      timestamp: new Date().toISOString(),
      keyName: apiKey?.name || 'unknown',
      keyId: apiKey?.id || 'unknown',
      method: c.req.method,
      path: c.req.path,
      model: c.get('model'),
      clientIp: c.get('clientIp'),
      statusCode: c.res.status,
      responseTimeMs: ms,
    };
    console.log(JSON.stringify(log));
  };
}
