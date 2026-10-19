/** Telegram ingress handles notification/status commands only, never exchange orders. */
export async function telegramIngress(req, env) {
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!env.TELEGRAM_WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) return reply({ error: 'Unauthorized' }, 403);
  let update;
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > 65536) return reply({ error: 'Payload too large' }, 413);
    update = JSON.parse(text);
  } catch { return reply({ error: 'Invalid JSON' }, 400); }
  const message = update?.message;
  const allowed = (csv, value) => String(csv || '').split(',').map(x => x.trim()).filter(Boolean).includes(String(value));
  if (!Number.isSafeInteger(update?.update_id) || !allowed(env.TELEGRAM_ALLOWED_CHAT_IDS, message?.chat?.id) ||
      !allowed(env.TELEGRAM_ALLOWED_USER_IDS, message?.from?.id)) return reply({ error: 'Sender not allowed' }, 403);
  if (!/^\/(start|status)(?:@\w+)?(?:\s|$)/.test(message?.text || '')) return reply({ ok: true, ignored: true });
  try {
    const target = new URL('/webhook/telegram', env.BOTKEEP_URL);
    if (target.protocol !== 'https:') return reply({ error: 'HTTPS backend required' }, 503);
    const id = String(update.update_id), now = Date.now();
    const claim = await env.DB.prepare(`INSERT INTO telegram_updates(id,status,updated_at) VALUES(?,'PROCESSING',?)
      ON CONFLICT(id) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at
      WHERE telegram_updates.status='FAILED' OR (telegram_updates.status='PROCESSING' AND telegram_updates.updated_at<?)`)
      .bind(id, now, now - 60000).run();
    if (!claim.meta.changes) {
      const row = await env.DB.prepare('SELECT status FROM telegram_updates WHERE id=?').bind(id).all();
      return row.results[0]?.status === 'DONE' ? reply({ ok: true, duplicate: true }) : reply({ error: 'Update in progress' }, 503);
    }
    try {
      const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(update), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Backend unavailable');
      await env.DB.prepare("UPDATE telegram_updates SET status='DONE',updated_at=? WHERE id=?").bind(Date.now(), id).run();
      return reply({ ok: true });
    } catch {
      await env.DB.prepare("UPDATE telegram_updates SET status='FAILED',updated_at=? WHERE id=?").bind(Date.now(), id).run();
      return reply({ error: 'Delivery failed; retry later' }, 503);
    }
  } catch { return reply({ error: 'Ingress unavailable' }, 503); }
}
