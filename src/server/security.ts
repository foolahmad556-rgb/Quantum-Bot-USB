import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function secretEquals(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function isOperator(email: string): boolean {
  return (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase())
    .filter(Boolean).includes(email.trim().toLowerCase());
}

// Bounded per-address limiter. Configure TRUST_PROXY_HOPS only for the verified
// ingress topology; arbitrary X-Forwarded-For headers must not bypass this limit.
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const buckets = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    const now = Date.now(), key = req.ip || req.socket.remoteAddress || 'unknown';
    for (const [ip, value] of buckets) if (value.until <= now) buckets.delete(ip);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 10000) return void res.status(429).json({ success: false, error: 'Rate limit capacity reached' });
      bucket = { count: 0, until: now + windowMs }; buckets.set(key, bucket);
    }
    if (++bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.until - now) / 1000));
      return void res.status(429).json({ success: false, error: 'Too many requests' });
    }
    next();
  };
}
