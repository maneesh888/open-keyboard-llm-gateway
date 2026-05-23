import type { Context, Next } from 'hono';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../types/index.js';

function ipv4ToUint32(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIPv4InCIDR(ip: string, cidr: string): boolean {
  try {
    const [network, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);
    if (prefix === 0) return true;
    const mask = (~0 << (32 - prefix)) >>> 0;
    return (ipv4ToUint32(ip) & mask) === (ipv4ToUint32(network) & mask);
  } catch {
    return false;
  }
}

function expandIPv6(ip: string): string {
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    const groups = [...leftGroups, ...Array(missing).fill('0000'), ...rightGroups];
    return groups.map(g => g.padStart(4, '0')).join(':');
  }
  return ip.split(':').map(g => g.padStart(4, '0')).join(':');
}

function isIPv6InCIDR(ip: string, cidr: string): boolean {
  try {
    const [network, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);
    const ipBin = expandIPv6(ip).split(':').map(g => parseInt(g, 16).toString(2).padStart(16, '0')).join('');
    const netBin = expandIPv6(network).split(':').map(g => parseInt(g, 16).toString(2).padStart(16, '0')).join('');
    return ipBin.slice(0, prefix) === netBin.slice(0, prefix);
  } catch {
    return false;
  }
}

function isIPInCIDRList(ip: string, cidrs: string[]): boolean {
  // Unwrap IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const cleanIP = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const isV4 = /^\d+\.\d+\.\d+\.\d+$/.test(cleanIP);

  for (const cidr of cidrs) {
    const isV4CIDR = /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidr);
    if (isV4 && isV4CIDR && isIPv4InCIDR(cleanIP, cidr)) return true;
    if (!isV4 && !isV4CIDR && isIPv6InCIDR(cleanIP, cidr)) return true;
  }
  return false;
}

export function trustedProxyMiddleware(config: AppConfig) {
  const trustedProxies = config.trustedProxies ?? [];

  return async (c: Context, next: Next) => {
    let clientIp: string | undefined;

    if (trustedProxies.length > 0) {
      const env = c.env as { incoming?: IncomingMessage; outgoing?: ServerResponse };
      const remoteAddress = env.incoming?.socket?.remoteAddress ?? '';

      if (remoteAddress && isIPInCIDRList(remoteAddress, trustedProxies)) {
        // Request came from a trusted proxy — trust its forwarded IP headers
        const cfConnectingIP = c.req.header('CF-Connecting-IP');
        const xForwardedFor = c.req.header('X-Forwarded-For');
        clientIp = cfConnectingIP ?? xForwardedFor?.split(',')[0].trim();
      }

      if (!clientIp) {
        // Not from a trusted proxy — use the direct connection IP
        const env2 = c.env as { incoming?: IncomingMessage };
        clientIp = env2.incoming?.socket?.remoteAddress;
      }
    }

    if (clientIp) c.set('clientIp', clientIp);
    await next();
  };
}
