/**
 * Cloudflare Worker Webhook for Quantum-Bot
 * Free tier compatible
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    
    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response('Quantum-Bot Webhook Active', {
        headers: { 'Content-Type': 'text/plain' }
      })
    }
    
    // Trading signal webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        // Validate Bearer token
        const auth = request.headers.get('Authorization')
        if (!auth || auth !== `Bearer ${env.WEBHOOK_SECRET}`) {
          return new Response('Unauthorized', { status: 401 })
        }
        
        const signal = await request.json()
        
        // Forward to Supabase
        const supabaseResponse = await fetch(
          `${env.SUPABASE_URL}/rest/v1/trading_signals`,
          {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify(signal)
          }
        )
        
        return new Response(JSON.stringify({
          status: 'ok',
          received: signal,
          supabase: supabaseResponse.ok ? 'stored' : 'failed'
        }), {
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }
    
    return new Response('Not Found', { status: 404 })
  }
}