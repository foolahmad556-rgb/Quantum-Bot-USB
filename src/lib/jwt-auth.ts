import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_EXPIRES_IN = '7d';

export interface JWTPayload {
  userId: string;
  email: string;
}

/**
 * Generate JWT token.
 */
export function generateToken(payload: JWTPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify JWT token. Throws if invalid/expired.
 */
export function verifyToken(token: string, secret: string): JWTPayload {
  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JWTPayload;
}

/**
 * Hash password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Compare password with hash.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
