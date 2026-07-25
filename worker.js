// rauszeit. — Cloudflare Worker API Proxy mit KV-Cache
// Secrets: ANTHROPIC_API_KEY, APP_PASSWORD
// KV Binding: CACHE

const CACHE_TTL = 60 * 60 * 24 * 90; // 90 Tage

export default {
  async fetch(request, env, ctx) {

    const allowedOrigins = ['https://rauszeit.pages.dev', 'http://localhost', 'null'];
    const origin = request.headers.get('Origin') || '';
    const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Password',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

    const url = new URL(request.url);
    if (url.pathname !== '/api/venues') return new Response('Not found', { status: 404, headers: corsHeaders });

    const appPassword = request.headers.get('X-App-Password');
    if (!appPassword || appPassword.trim() !== env.APP_PASSWORD?.trim()) {
      return new Response(JSON.stringify({ error: { message: 'Falsches Passwort.' } }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try { body = await request.json(); }
    catch { return new Response('Invalid JSON', { status: 400, headers: corsHeaders }); }

    // Cache-Key via SHA-256
    const promptText = body?.messages?.[0]?.content || '';
    const msgBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(promptText));
    const cacheKey = 'v1_' + Array.from(new Uint8Array(msgBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');

    // KV Cache prüfen
    try {
      const cached = await env.CACHE.get(cacheKey);
      if (cached) {
        const fakeResponse = JSON.stringify({ content: [{ type: 'text', text: cached }] });
        return new Response(fakeResponse, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
        });
      }
    } catch(e) {}

    // Anthropic ohne Streaming aufrufen damit wir die komplette Antwort cachen können
    const bodyNoStream = { ...body, stream: false };
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(bodyNoStream),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return new Response(err, { status: anthropicRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Komplette Antwort lesen
    const responseData = await anthropicRes.json();
    const fullText = responseData.content?.map(b => b.text || '').join('') || '';

    // In KV speichern
    if (fullText.length > 100) {
      ctx.waitUntil(env.CACHE.put(cacheKey, fullText, { expirationTtl: CACHE_TTL }));
    }

    // Als JSON zurückgeben (App verarbeitet das über X-Cache HIT Handler)
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    });
  },
};
