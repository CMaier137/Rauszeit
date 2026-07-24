// rauszeit. — Cloudflare Worker API Proxy mit AI Gateway
// Secrets in Cloudflare hinterlegen (Settings → Variables and secrets):
//   ANTHROPIC_API_KEY  — dein Anthropic API Key (sk-ant-...)
//   APP_PASSWORD       — das Passwort das Nutzer eingeben
//
// Ersetze {ACCOUNT_ID} mit deiner Cloudflare Account ID
// (zu finden im Cloudflare Dashboard rechts unter "Account ID")

const GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/6490c481f8d33a346385a52b7acd2914/rauszeit/anthropic/v1/messages';

export default {
  async fetch(request, env) {

    // ── CORS ──────────────────────────────────────────────────────
    const allowedOrigins = [
      'https://rauszeit.pages.dev',
      'http://localhost',
      'null',
    ];
    const origin = request.headers.get('Origin') || '';
    const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Password',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/api/venues') {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    // ── Passwort prüfen ───────────────────────────────────────────
    const appPassword = request.headers.get('X-App-Password');
    if (!appPassword || appPassword !== env.APP_PASSWORD) {
      return new Response(JSON.stringify({ error: { message: 'Falsches Passwort.' } }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Request Body lesen ────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
    }

    // ── Anfrage über AI Gateway an Anthropic weiterleiten ─────────
    const anthropicRes = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return new Response(err, {
        status: anthropicRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Streaming direkt durchleiten ──────────────────────────────
    return new Response(anthropicRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  },
};
