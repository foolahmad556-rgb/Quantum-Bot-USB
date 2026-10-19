import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { telegramIngress } from '../../api/telegram-ingress.js';
import { sqliteD1 } from '../testing/sqliteD1';
const DB = await sqliteD1(), secret = randomBytes(32).toString('hex');
const env = { DB, TELEGRAM_WEBHOOK_SECRET: secret, TELEGRAM_ALLOWED_CHAT_IDS:'1', TELEGRAM_ALLOWED_USER_IDS:'2', BOTKEEP_URL:'https://backend.invalid' };
const request = (update: any, authenticated=true) => new Request('https://worker.invalid/webhook/telegram', {method:'POST',headers: authenticated?{'x-telegram-bot-api-secret-token':secret}:{},body:JSON.stringify(update)});
const update = {update_id:10,message:{text:'/status',chat:{id:1},from:{id:2}}};
const original = globalThis.fetch; let sent = 0;
globalThis.fetch = async (_url, options) => { sent++; assert.equal(new Headers(options?.headers).get('x-telegram-bot-api-secret-token'),secret); return new Response('{}'); };
try {
  assert.equal((await telegramIngress(request(update,false),env)).status,403);
  assert.equal((await telegramIngress(request({...update,message:{...update.message,from:{id:3}}}),env)).status,403);
  assert.equal((await telegramIngress(request(update),env)).status,200);
  assert.equal((await telegramIngress(request(update),env)).status,200); assert.equal(sent,1);
  await telegramIngress(request({...update,update_id:11,message:{...update.message,text:'/buy BTC'}}),env);
  assert.equal(sent,1,'No trading commands forwarded');
  console.log('PASS Telegram secret, sender allowlist, durable deduplication and read-only commands');
} finally { globalThis.fetch=original; await DB.close(); }
