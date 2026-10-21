import sqlite3 from 'sqlite3';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../lib/jwt-auth';

export interface AuthUser { id: string; email: string; password_hash: string; created_at: number }

/** D1 is authoritative; local SQLite is read only during legacy migration. */
export class AuthStore {
  constructor(private url = process.env.D1_API_URL || '', private secret = process.env.D1_API_SECRET || '') {}
  private async call(route: string, body?: unknown): Promise<any> {
    if (!this.url || !this.secret) throw new Error('D1 authentication storage is not configured');
    const response = await fetch(`${this.url.replace(/\/$/, '')}/d1/auth/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Authentication storage unavailable (${response.status})`);
    return response.json();
  }
  async count(): Promise<number> { return (await this.call('health')).count; }
  async find(email: string): Promise<AuthUser | null> { return (await this.call('lookup', { email })).user; }
  async create(user: AuthUser, bootstrapOnly = false): Promise<boolean> {
    return (await this.call('users', { ...user, bootstrapOnly })).created;
  }
  async initialize(legacyPath: string, allowed: (email: string) => boolean): Promise<void> {
    await this.count(); // Never fall back to an empty, temporary local database.
    if (fs.existsSync(legacyPath)) {
      const db = await new Promise<sqlite3.Database>((resolve, reject) => {
        const handle = new sqlite3.Database(legacyPath, sqlite3.OPEN_READONLY, err => err ? reject(err) : resolve(handle));
      });
      try {
        const users = await new Promise<AuthUser[]>((resolve, reject) => db.all('SELECT id,email,password_hash,created_at FROM users', (err, rows) => err ? reject(err) : resolve(rows as AuthUser[])));
        for (const user of users) {
          const email = user.email.trim().toLowerCase();
          // Existing D1 passwords always win, including after a password change.
          if (!await this.find(email)) await this.create({ ...user, email });
        }
      } finally { await new Promise<void>((resolve, reject) => db.close(err => err ? reject(err) : resolve())); }
    }
    if (await this.count() === 0) {
      const email = (process.env.USER_EMAIL || '').trim().toLowerCase();
      const password = process.env.USER_PASSWORD || '';
      if (!email || !allowed(email)) throw new Error('Empty account store: USER_EMAIL must be listed in ADMIN_EMAILS');
      if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Empty account store: USER_PASSWORD must be 12+ characters and at most 72 UTF-8 bytes');
      await this.create({ id: randomUUID(), email, password_hash: await hashPassword(password), created_at: Date.now() }, true);
    }
    const configured = (process.env.USER_EMAIL || '').trim().toLowerCase();
    if (configured) {
      const user = await this.find(configured);
      const matches = user && process.env.USER_PASSWORD
        ? await (await import('../lib/jwt-auth')).comparePassword(process.env.USER_PASSWORD, user.password_hash) : false;
      console.log(`Auth bootstrap check: account=${!!user} operator=${allowed(configured)} configuredPasswordMatches=${!!matches}`);
    }
  }
}
