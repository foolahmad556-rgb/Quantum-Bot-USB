// Explicit operational command; never executed by install/build/test.
const token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const worker = process.env.D1_API_URL;
if (!token || !secret || !worker) throw new Error('TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and D1_API_URL required');
const url = new URL('/webhook/telegram', worker);
if (url.protocol !== 'https:') throw new Error('HTTPS Worker URL required');
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: url.href, secret_token: secret, allowed_updates: ['message'] }), signal: AbortSignal.timeout(10000),
});
const body = await response.json();
if (!response.ok || !body.ok) throw new Error('Telegram rejected webhook configuration');
console.log('Telegram webhook configured; verify /status from an authorized user/chat.');
