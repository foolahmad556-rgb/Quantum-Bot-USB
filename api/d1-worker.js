import { telegramIngress } from './telegram-ingress.js';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const rows = async (env, sql, params = []) => (await env.DB.prepare(sql).bind(...params).all()).results || [];
const run = (env, sql, params = []) => env.DB.prepare(sql).bind(...params).run();
const payloads = records => records.map(row => JSON.parse(row.payload));
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const boundedLimit = value => Math.max(1, Math.min(1000, Number.isFinite(Number(value)) ? Math.floor(Number(value)) || 100 : 100));

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname, method = req.method;
    if (path === '/webhook/telegram') return telegramIngress(req, env);
    if (path === '/' || path === '/health') return json({ success: true, status: 'alive' });
    if (!env.D1_API_SECRET || req.headers.get('Authorization') !== `Bearer ${env.D1_API_SECRET}`) {
      return json({ error: 'Unauthorized' }, 401);
    }
    try {
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        const text = await req.text();
        if (new TextEncoder().encode(text).length > 1024 * 1024) return json({ error: 'Payload too large' }, 413);
        try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Object required' }, 400);
      }
      if (path === '/d1/health' && method === 'GET') {
        // Probe schema, not just connectivity; unapplied migrations must fail readiness.
        await rows(env, 'SELECT key FROM bot_state LIMIT 1');
        await rows(env, 'SELECT id FROM orders LIMIT 1');
        await rows(env, 'SELECT name FROM runtime_leases LIMIT 1');
        return json({ ok: true, storage: 'cloudflare-d1' });
      }
      const lease = path.match(/^\/d1\/leases\/([^/]+)$/);
      if (lease && method === 'PUT') {
        const name = decodeURIComponent(lease[1]), owner = body.owner;
        if (!validId(name) || !validId(owner)) return json({ error: 'Lease name/owner required' }, 400);
        const now = Date.now(), expires = now + 30000;
        await run(env, `INSERT INTO runtime_leases(name,owner,expires_at) VALUES(?,?,?)
          ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
          WHERE runtime_leases.owner=excluded.owner OR runtime_leases.expires_at<=?`, [name, owner, expires, now]);
        const found = await rows(env, 'SELECT owner,expires_at FROM runtime_leases WHERE name=?', [name]);
        const acquired = found[0]?.owner === owner;
        return json({ acquired, expiresAt: acquired ? found[0].expires_at : null }, acquired ? 200 : 409);
      }
      if (lease && method === 'DELETE') {
        // Owner supplied in a header; another process must not release the lease.
        await run(env, 'DELETE FROM runtime_leases WHERE name=? AND owner=?', [decodeURIComponent(lease[1]), req.headers.get('X-Lease-Owner') || '']);
        return json({ ok: true });
      }
      if (path === '/d1/orders/claim' && method === 'POST') {
        if (!validId(body.id) || !validId(body.requestHash)) return json({ error: 'Order id and request hash required' }, 400);
        const id = body.id;
        const result = await run(env, 'INSERT OR IGNORE INTO orders(id,request_hash,payload,updated_at) VALUES(?,?,?,?)',
          [id, body.requestHash, JSON.stringify({ id, requestHash: body.requestHash, status: 'CLAIMED' }), Date.now()]);
        const existing = await rows(env, 'SELECT payload FROM orders WHERE id=?', [id]);
        return json({ claimed: result.meta.changes === 1, order: JSON.parse(existing[0].payload) });
      }
      const order = path.match(/^\/d1\/orders\/([^/]+)$/);
      if (order && method === 'PUT') {
        if (body.id !== decodeURIComponent(order[1]) || !validId(body.status)) return json({ error: 'Invalid order' }, 400);
        const saved = await rows(env, 'SELECT request_hash FROM orders WHERE id=?', [body.id]);
        if (!saved[0]) return json({ error: 'Order claim not found' }, 404);
        await run(env, 'UPDATE orders SET payload=?,updated_at=? WHERE id=?', [JSON.stringify({ ...body, requestHash: saved[0].request_hash }), Date.now(), body.id]);
        return json({ ok: true });
      }
      if (path === '/d1/orders' && method === 'GET') {
        return json({ items: payloads(await rows(env, 'SELECT payload FROM orders ORDER BY updated_at DESC LIMIT ?', [boundedLimit(url.searchParams.get('limit'))])) });
      }
      if (path === '/d1/council/shadow' && method === 'POST') {
        const id = String(body.id || `${body.createdAt || Date.now()}-${body.symbol || 'unknown'}`).slice(0, 200);
        await run(env, 'INSERT OR REPLACE INTO council_shadow(id,payload,created_at) VALUES(?,?,?)', [id, JSON.stringify({ ...body, id }), Date.now()]);
        return json({ ok: true, id });
      }
      if (path === '/d1/council/shadow' && method === 'GET') {
        return json({ items: payloads(await rows(env, 'SELECT payload FROM council_shadow ORDER BY created_at DESC LIMIT ?', [boundedLimit(url.searchParams.get('limit'))])) });
      }
      if (path === '/d1/trades' && method === 'POST') {
        if (!validId(body.id) || !validId(body.symbol)) return json({ error: 'Trade id and symbol required' }, 400);
        await run(env, 'INSERT OR REPLACE INTO trades(id,payload,updated_at) VALUES(?,?,?)', [body.id, JSON.stringify(body), Date.now()]);
        return json({ ok: true });
      }
      if ((path === '/d1/trades' || path === '/d1/trades/open') && method === 'GET') {
        const symbol = url.searchParams.get('symbol'), filters = [], params = [];
        if (path.endsWith('/open')) filters.push("json_extract(payload,'$.status')='OPEN'");
        if (symbol) { filters.push("json_extract(payload,'$.symbol')=?"); params.push(symbol); }
        return json({ items: payloads(await rows(env, `SELECT payload FROM trades ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''} ORDER BY updated_at DESC`, params)) });
      }
      const trade = path.match(/^\/d1\/trades\/([^/]+)$/);
      if (trade && method === 'PATCH') {
        const id = decodeURIComponent(trade[1]), existing = await rows(env, 'SELECT payload FROM trades WHERE id=?', [id]);
        if (!existing[0]) return json({ error: 'Trade not found' }, 404);
        if (!Number.isFinite(body.pnl)) return json({ error: 'Finite pnl required' }, 400);
        const value = { ...JSON.parse(existing[0].payload), pnl: body.pnl, exitPrice: body.exitPrice, fee: body.fee, status: 'CLOSED', closedAt: Date.now() };
        await run(env, 'UPDATE trades SET payload=?,updated_at=? WHERE id=?', [JSON.stringify(value), Date.now(), id]);
        return json({ ok: true });
      }
      if (path === '/d1/signals' && method === 'POST') {
        if (!validId(body.id)) return json({ error: 'Signal id required' }, 400);
        await run(env, 'INSERT OR IGNORE INTO signals(id,payload,created_at) VALUES(?,?,?)', [body.id, JSON.stringify(body), Date.now()]);
        return json({ ok: true });
      }
      if (path === '/d1/balances' && method === 'POST') {
        await run(env, 'INSERT INTO balance_snapshots(payload,created_at) VALUES(?,?)', [JSON.stringify(body), Date.now()]);
        return json({ ok: true });
      }
      const state = path.match(/^\/d1\/state\/([^/]+)$/);
      if (state && method === 'PUT') {
        if (body.value === undefined) return json({ error: 'State value required' }, 400);
        await run(env, 'INSERT OR REPLACE INTO bot_state(key,payload,updated_at) VALUES(?,?,?)', [decodeURIComponent(state[1]), JSON.stringify(body.value), Date.now()]);
        return json({ ok: true });
      }
      if (state && method === 'GET') {
        const result = await rows(env, 'SELECT payload FROM bot_state WHERE key=?', [decodeURIComponent(state[1])]);
        return json({ value: result[0] ? JSON.parse(result[0].payload) : null });
      }
      if (path === '/d1/prices' && method === 'POST') {
        if (!validId(body.symbol) || !Number.isFinite(body.price) || body.price <= 0) return json({ error: 'Invalid price' }, 400);
        const value = { symbol: body.symbol, price: body.price, timestamp: Date.now() };
        await run(env, 'INSERT INTO prices(symbol,payload,created_at) VALUES(?,?,?)', [body.symbol, JSON.stringify(value), value.timestamp]);
        return json({ ok: true });
      }
      const prices = path.match(/^\/d1\/prices\/([^/]+)$/);
      if (prices && method === 'GET') {
        const result = await rows(env, 'SELECT payload FROM prices WHERE symbol=? ORDER BY id DESC LIMIT ?', [decodeURIComponent(prices[1]), boundedLimit(url.searchParams.get('limit'))]);
        return json({ items: payloads(result).reverse() });
      }
      // Arbitrary SQL is deliberately not a public storage contract.
      return json({ error: 'Not Found' }, 404);
    } catch {
      return json({ error: 'Storage operation failed' }, 503);
    }
  },
};
