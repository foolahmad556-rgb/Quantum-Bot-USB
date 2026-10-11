#!/usr/bin/env typescript
/**
 * Supabase Edge Function - Quantum Bot Webhook
 * Free tier compatible - uses same infra as database
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!
)

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const secret = Deno.env.get('WEBHOOK_SECRET')

  // Health check
  if (url.pathname === '/health' || req.method === 'GET') {
    return new Response('OK', { status: 200 })
  }

  // Webhook endpoint
  if (url.pathname === '/webhook' && req.method === 'POST') {
    // Validate Bearer token
    const auth = req.headers.get('Authorization')
    if (!auth || auth !== `Bearer ${secret}`) {
      return new Response('Unauthorized', { status: 401 })
    }

    try {
      const signal = await req.json()

      // Store in Supabase
      const { data, error } = await supabase
        .from('trading_signals')
        .insert({
          signal_type: signal.type || 'auto',
          symbol: signal.symbol,
          action: signal.action,
          price: signal.price,
          quantity: signal.quantity || 0.001,
          strategy: signal.strategy || 'webhook',
          confidence: signal.confidence || 0.5,
          status: 'pending'
        })
        .select()
        .single()

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message, status: 'db_error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          status: 'stored',
          signal: data,
          received: signal
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  return new Response('Not Found', { status: 404 })
})