import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import worker from '../../api/d1-worker.js';
import { sqliteD1 } from '../testing/sqliteD1';
import { AuthStore } from '../storage/AuthStore';
import { hashPassword, comparePassword } from '../lib/jwt-auth';
const DB = await sqliteD1(), secret = 'test-private-worker-key';
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const response = await worker.fetch(new Request(`http://test${req.url}`, { method: req.method,
    headers: { Authorization: req.headers.authorization || '' },
    ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString() } : {}),
  }), { DB, D1_API_SECRET: secret });
  res.writeHead(response.status); res.end(await response.text());
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${(server.address() as any).port}`, temp = await mkdtemp(path.join(tmpdir(), 'auth-persist-'));
const legacy = path.join(temp, 'users.db');
try {
  const store = new AuthStore(url, secret);
  process.env.USER_EMAIL = 'Owner@Example.invalid'; process.env.USER_PASSWORD = 'first-password-123456';
  const allowed = (email: string) => email === 'owner@example.invalid';
  await store.initialize(legacy, allowed);
  const first = await store.find('owner@example.invalid'); assert.ok(first);
  assert.ok(await comparePassword('first-password-123456', first.password_hash));
  process.env.USER_PASSWORD = 'changed-bootstrap-password';
  // New server instance, absent local DB: preserve ID and password in D1.
  await new AuthStore(url, secret).initialize(legacy, allowed);
  assert.deepEqual(await store.find('owner@example.invalid'), first);
  assert.equal(await store.create({ ...first, id: 'other', email: 'other@example.invalid' }, true), false);
  assert.equal(await store.count(), 1);
  assert.equal((await fetch(url+'/d1/auth/health')).status, 401);
  await assert.rejects(new AuthStore(url, 'wrong').initialize(legacy, allowed));
  // Migrate a populated legacy DB without overwriting the existing remote account.
  const db = new sqlite3.Database(legacy), hash = await hashPassword('legacy-password-123');
  await new Promise<void>((resolve, reject) => db.exec('CREATE TABLE users(id TEXT,email TEXT,password_hash TEXT,created_at INTEGER)', e=>e?reject(e):resolve()));
  for (const email of ['Owner@Example.invalid', 'legacy@example.invalid']) {
    await new Promise<void>((resolve, reject) => db.run('INSERT INTO users VALUES(?,?,?,?)',[email,email,hash,1],e=>e?reject(e):resolve()));
  }
  await new Promise<void>(resolve=>db.close(()=>resolve()));
  await store.initialize(legacy, allowed);
  assert.deepEqual(await store.find('owner@example.invalid'), first);
  assert.equal((await store.find('legacy@example.invalid'))?.password_hash, hash);
  await rm(legacy);
  await new AuthStore(url, secret).initialize(legacy, allowed);
  assert.equal(await store.count(), 2);
  console.log('PASS durable auth, first bootstrap, legacy migration, redeploy without local DB, no password reset, private Worker access');
} finally {
  await new Promise<void>(resolve=>server.close(()=>resolve())); await DB.close(); await rm(temp,{recursive:true,force:true});
}
