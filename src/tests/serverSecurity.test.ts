import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { generateToken } from '../lib/jwt-auth';
const root = process.cwd(), temp = await mkdtemp(path.join(os.tmpdir(), 'quantum-http-'));
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as net.AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
const jwt = randomBytes(48).toString('hex'), operator = randomBytes(32).toString('hex');
await mkdir(path.join(temp, 'dist/assets'), { recursive: true });
await writeFile(path.join(temp, 'dist/index.html'), '<html>test UI</html>');
for (const file of ['users.db', 'server.cjs', 'server.cjs.map']) await writeFile(path.join(temp,'dist',file), 'must remain private');
const child = spawn(process.execPath, ['--import', path.join(root,'node_modules/tsx/dist/loader.mjs'), path.join(root,'server.ts')], {
  cwd: temp, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JWT_SECRET: jwt, OPERATOR_SECRET: operator,
    ADMIN_EMAILS: 'operator@example.invalid', EXECUTION_MODE: 'PAPER', AUTO_START_TRADING: 'false', AUTOSTART_TRADING: 'false',
    D1_API_URL: '', D1_API_SECRET: '', STORAGE_BACKEND: '', AUTH_DB_PATH: path.join(temp,'auth/users.db'), FRONTEND_DIST_DIR: path.join(temp,'dist'),
    TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHANNEL_ID: '', TELEGRAM_WEBHOOK_SECRET: '', EXCHANGE_API_KEY: '', EXCHANGE_API_SECRET: '',
  }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
const base = `http://127.0.0.1:${port}`;
try {
  const deadline = Date.now() + 20000;
  while (!logs.includes('SQLite users DB ready') && Date.now() < deadline && child.exitCode === null) await new Promise(r => setTimeout(r, 50));
  assert.match(logs, /SQLite users DB ready/, 'Server failed to initialize local DB');
  for (const p of ['/users.db', '/server.cjs', '/server.cjs.map', '/data/auth/users.db']) assert.equal((await fetch(base+p)).status,404,p);
  assert.equal((await fetch(base)).status,200);
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/api/ready')).status,503);
  const account = { email: 'operator@example.invalid', password: randomBytes(16).toString('hex') };
  const post = (route: string, data: any, token?: string) => fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});
  assert.equal((await post('/api/auth/register', account)).status,401);
  assert.equal((await post('/api/auth/register', account, operator)).status,200);
  const login = await post('/api/auth/login',account); assert.equal(login.status,200);
  const token = (await login.json()).token;
  const readOnly = generateToken({ userId:'unknown',email:'unlisted@example.invalid' },jwt);
  assert.equal((await fetch(base+'/api/protected/order-history',{headers:{Authorization:`Bearer ${readOnly}`}})).status,403);
  assert.equal((await post('/api/board/learn',{pnl:100,symbol:'BTC/USDT'})).status,401);
  assert.equal((await post('/api/board/learn',{pnl:100,symbol:'BTC/USDT'},token)).status,409);
  assert.equal((await post('/api/protected/trading/start',{},token)).status,409);
  assert.equal((await post('/webhook/telegram',{})).status,503);
  for(let i=0;i<22;i++) await post('/api/auth/login',{email:account.email,password:'wrong'});
  assert.equal((await post('/api/auth/login',account)).status,429);
  console.log('PASS real HTTP auth provisioning, operator authorization, private assets, readiness, learning boundary and rate limits');
} finally {
  if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,12000))]); }
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(temp,{recursive:true,force:true});
}
