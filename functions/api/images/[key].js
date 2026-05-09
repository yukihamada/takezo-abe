// Cloudflare Pages Function: /api/images/<key>
// GET  → serve image from R2 (public, with caching)
// PUT  → upload image to R2 (requires X-Edit-Password header)
//        body = raw bytes; Content-Type must be image/*

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'
]);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_KEYS = /^[a-z0-9_-]{1,64}$/;

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

function corsHeaders(origin) {
  const ok = origin === 'https://takezo.jiuflow.com' || origin === 'https://takezo-abe.pages.dev';
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://takezo.jiuflow.com',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Password',
    'Access-Control-Max-Age': '86400'
  };
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin') || '') });
}

export async function onRequestGet({ params, env }) {
  const key = String(params.key || '');
  if (!ALLOWED_KEYS.test(key)) {
    return new Response('Bad key', { status: 400 });
  }
  if (!env.IMAGES) {
    return new Response('R2 not bound', { status: 500 });
  }
  const obj = await env.IMAGES.get(key);
  if (!obj) {
    return new Response('Not found', { status: 404 });
  }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // Ensure content-type is from R2 metadata, falling back to image/jpeg
  const stored = obj.httpMetadata?.contentType;
  headers.set('Content-Type', stored || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=86400');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(obj.body, { headers });
}

export async function onRequestPut({ request, params, env }) {
  const origin = request.headers.get('Origin') || '';
  const key = String(params.key || '');
  if (!ALLOWED_KEYS.test(key)) {
    return new Response(JSON.stringify({ ok: false, error: 'Bad key' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }
  if (!env.EDIT_PASSWORD) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }
  const pw = request.headers.get('X-Edit-Password') || '';
  if (!timingSafeEqual(pw, env.EDIT_PASSWORD)) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid password' }), {
      status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }
  if (!env.IMAGES) {
    return new Response(JSON.stringify({ ok: false, error: 'R2 not bound' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  const ct = request.headers.get('Content-Type') || '';
  if (!ALLOWED_TYPES.has(ct.split(';')[0].trim())) {
    return new Response(JSON.stringify({ ok: false, error: 'Unsupported type. Use image/jpeg, png, webp, gif, or avif.' }), {
      status: 415, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }
  const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (cl > MAX_BYTES) {
    return new Response(JSON.stringify({ ok: false, error: `File too large (${(cl/1024/1024).toFixed(1)}MB > 8MB)` }), {
      status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) {
    return new Response(JSON.stringify({ ok: false, error: 'Body too large' }), {
      status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }

  await env.IMAGES.put(key, body, { httpMetadata: { contentType: ct } });

  return new Response(JSON.stringify({
    ok: true,
    key,
    url: `/api/images/${key}`,
    bytes: body.byteLength,
    type: ct,
    savedAt: new Date().toISOString()
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) }
  });
}
