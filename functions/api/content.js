// Cloudflare Pages Function: /api/content
// GET  → returns the current content JSON
// POST → updates the content JSON (requires X-Edit-Password header)

const CONTENT_KEY = 'site-content-v1';
const ALLOWED_ORIGINS = new Set([
  'https://takezo.jiuflow.com',
  'https://takezo-abe.pages.dev'
]);

const DEFAULT_CONTENT = {
  hero: {
    eyebrow: 'Para Jiu-Jitsu Black Belt',
    title_1: '車椅子で、',
    title_2: '世界一',
    title_3: 'になった。',
    subtitle: 'ABE TAKEZO ／ 阿部 武蔵',
    lead: '2017年、受傷。<br>2018年、好奇心で柔術と出会う。<br>2025年、日本初の車椅子黒帯。Abu Dhabi 世界選手権 <strong>二階級制覇</strong>。<br>柔術は、人生を面白くする <em>共通言語</em>。',
    cta_primary: 'パラ柔術をはじめる →',
    cta_secondary: '武蔵の8年を読む',
    photo_caption: 'Abu Dhabi · 2025 · World Champion'
  },
  stats: {
    s1_num: '8',  s1_unit: '年',     s1_label: '柔術歴',
    s2_num: '黒', s2_unit: '',        s2_label: '帯 ／ 国内初',
    s3_num: '2',  s3_unit: '冠',     s3_label: 'Abu Dhabi 2025',
    s4_num: '∞',  s4_unit: '',        s4_label: '広めたい'
  },
  story: {
    title: '受傷から、世界一まで。<br>武蔵の8年。',
    lead: 'ベッドの上で見ていた天井を覚えている。<br>その自分が、世界の頂点で笑うとは思っていなかった。',
    quote: '柔術は、老若男女・国籍・障害の有無を超えて、<br>人生を面白くする <em style="color:var(--accent)">共通言語</em> だ。',
    quote_cite: '— 阿部武蔵'
  },
  master: {
    quote: '「武蔵を黒帯に推したのは、<br>車椅子だからじゃない。<br><em>柔術家として、本物だから</em>だ。」',
    name: '— 村田 良蔵 七段',
    title: 'SJJJF（スポーツ柔術日本連盟）会長／YAWARA JIU-JITSU ACADEMY 代表'
  },
  manifesto: {
    title: 'もし、いま<br>ベッドの上にいるなら、<br><em>これを読んでほしい。</em>',
    c1_title: '怖くて、当たり前。',
    c1_body: '俺もそうだった。<br>「車椅子で柔術？無理だろ」と思った。<br>でも、最初の道場で、誰も俺を哀れまなかった。仲間として迎えてくれた。',
    c2_title: 'できなくて、いい。',
    c2_body: '最初は何もできなかった。<br>立てないし、受け身も取れない。<br>それでも、毎週マットに来た。気がついたら、世界一になっていた。',
    c3_title: 'ひとりじゃない。',
    c3_body: 'YAWARA、SWEEP、世界中のパラ柔術仲間。<br>あなたが踏み出せば、輪はもう、できている。<br>「最初の体験」までの道、俺が案内する。'
  },
  profile: {
    academy: 'YAWARA JIU-JITSU ACADEMY ／ SWEEP',
    belt: '黒帯',
    belt_sub: 'Black Belt（2025年・国内車椅子初）',
    age: '35歳',
    age_sub: '1990年5月13日',
    years: '8年目',
    years_sub: '2018年〜・車椅子になってからスタート',
    master: '村田 良蔵',
    master_sub: 'SJJJF（スポーツ柔術日本連盟）会長 七段',
    motto: '気宇壮大',
    favorites: '鰻、つぶあん、キノコ料理、お肉',
    hobbies: 'ポーカー、シーシャ、車椅子競技',
    hobbies_sub: 'ハンドボール／バスケットボール／ソフトボール',
    dream: 'パラ柔術の先生になり、誰でも始められる場をつくること',
    looking: '共に汗をかける仲間 ／ 教え子 ／ 旅先での乾杯。<br>そして、人生を一緒に面白がってくれる、ひとり。',
    looking_sub: '老若男女・国籍・障害の有無を問わず、ご縁、募集中です。'
  },
  sns: {
    instagram: 'https://www.instagram.com/',
    twitter: '',
    youtube: '',
    email: 'hello@takezo-abe.com'
  }
};

// === Helpers ===

// Constant-time string comparison (timing-attack safe)
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// HTML sanitizer — allowlist of safe tags only.
// Strips <script>, on* event handlers, javascript: URLs, and disallowed tags.
const ALLOWED_TAGS = new Set(['br', 'strong', 'b', 'em', 'i', 'a', 'span']);
const ALLOWED_ATTRS = {
  a: new Set(['href', 'target', 'rel']),
  span: new Set(['class']),
  em: new Set(['class', 'style']),
  strong: new Set(['class'])
};
const ALLOWED_STYLE_PROPS = new Set(['color']);
const SAFE_URL_RE = /^(https?:|mailto:|tel:|#|\/)/i;

function sanitizeHtml(input) {
  if (typeof input !== 'string') return '';
  // Remove script blocks entirely (even if broken)
  let s = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove HTML comments (could hide payloads in some parsers)
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // Walk tags. Use regex-based parser sufficient for trusted-author input.
  return s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\/?>/g, (full, slash, tagName, rest) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (slash === '/') return `</${tag}>`;
    // Parse attributes
    const allowed = ALLOWED_ATTRS[tag] || new Set();
    let outAttrs = '';
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m;
    while ((m = attrRe.exec(rest)) !== null) {
      const name = m[1].toLowerCase();
      let value = (m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5]) || '';
      // Strip on* event handlers always
      if (name.startsWith('on')) continue;
      if (!allowed.has(name)) continue;
      // href/src URL validation
      if (name === 'href' || name === 'src') {
        if (!SAFE_URL_RE.test(value.trim())) continue;
      }
      // style: only allow safe properties (color)
      if (name === 'style') {
        const safe = value.split(';').map(p => p.trim()).filter(p => {
          const colon = p.indexOf(':');
          if (colon === -1) return false;
          const prop = p.slice(0, colon).trim().toLowerCase();
          const val = p.slice(colon + 1).trim();
          if (!ALLOWED_STYLE_PROPS.has(prop)) return false;
          // Block url() and expressions
          if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(val)) return false;
          return true;
        }).join('; ');
        if (!safe) continue;
        value = safe;
      }
      // Force rel="noopener" for target="_blank"
      outAttrs += ` ${name}="${value.replace(/"/g, '&quot;')}"`;
    }
    if (tag === 'a' && /target=["']_blank["']/.test(outAttrs) && !/rel=/.test(outAttrs)) {
      outAttrs += ' rel="noopener noreferrer"';
    }
    // self-closing for void tags
    if (tag === 'br') return '<br>';
    return `<${tag}${outAttrs}>`;
  });
}

function sanitizeContentDeep(value) {
  if (typeof value === 'string') return sanitizeHtml(value);
  if (Array.isArray(value)) return value.map(sanitizeContentDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = sanitizeContentDeep(value[k]);
    return out;
  }
  return value;
}

function mergeDeep(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const k of Object.keys(source || {})) {
    const v = source[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      out[k] = mergeDeep(target[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function getContent(env) {
  if (!env.CONTENT) return DEFAULT_CONTENT;
  const stored = await env.CONTENT.get(CONTENT_KEY, 'json');
  return stored || DEFAULT_CONTENT;
}

function corsHeaders(origin) {
  const ok = origin && ALLOWED_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://takezo.jiuflow.com',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Password',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(obj, { status = 200, origin = '' } = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin)
    }
  });
}

// === Rate limiting (KV-backed) ===
// 5 failed attempts per IP per 15min → block 15min
async function rateCheck(env, ip) {
  if (!env.CONTENT || !ip) return { allowed: true, remaining: 5 };
  const key = `rate:auth:${ip}`;
  const raw = await env.CONTENT.get(key, 'json');
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  if (raw && raw.until && raw.until > now) {
    return { allowed: false, retryAfter: Math.ceil((raw.until - now) / 1000) };
  }
  const fails = (raw && raw.windowStart && now - raw.windowStart < windowMs) ? raw.fails : 0;
  return { allowed: true, fails, windowStart: raw?.windowStart || now };
}
async function rateRecordFail(env, ip, state) {
  if (!env.CONTENT || !ip) return;
  const fails = (state.fails || 0) + 1;
  const windowMs = 15 * 60 * 1000;
  const key = `rate:auth:${ip}`;
  if (fails >= 5) {
    const until = Date.now() + windowMs;
    await env.CONTENT.put(key, JSON.stringify({ until }), { expirationTtl: 16 * 60 });
  } else {
    await env.CONTENT.put(key, JSON.stringify({
      fails, windowStart: state.windowStart || Date.now()
    }), { expirationTtl: 16 * 60 });
  }
}
async function rateClear(env, ip) {
  if (!env.CONTENT || !ip) return;
  await env.CONTENT.delete(`rate:auth:${ip}`);
}

// === Handlers ===

export async function onRequestOptions({ request }) {
  return jsonResponse({ ok: true }, { origin: request.headers.get('Origin') || '' });
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const content = await getContent(env);
  return jsonResponse({ ok: true, content }, { origin });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const ip = request.headers.get('CF-Connecting-IP') || '';

  // Rate-limit gate first
  const rate = await rateCheck(env, ip);
  if (!rate.allowed) {
    return jsonResponse({ ok: false, error: `Too many attempts. Retry in ${rate.retryAfter}s.` },
      { status: 429, origin });
  }

  if (!env.EDIT_PASSWORD) {
    return jsonResponse({ ok: false, error: 'Server misconfigured' }, { status: 500, origin });
  }

  const password = request.headers.get('X-Edit-Password') || '';
  if (!timingSafeEqual(password, env.EDIT_PASSWORD)) {
    await rateRecordFail(env, ip, rate);
    return jsonResponse({ ok: false, error: 'Invalid password' }, { status: 401, origin });
  }

  // Success → clear failure counter
  await rateClear(env, ip);

  if (!env.CONTENT) {
    return jsonResponse({ ok: false, error: 'KV not bound' }, { status: 500, origin });
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'Invalid JSON' }, { status: 400, origin }); }

  if (!body || typeof body !== 'object' || !body.content) {
    return jsonResponse({ ok: false, error: 'Missing content' }, { status: 400, origin });
  }

  // Reject pathological payloads
  const serialized = JSON.stringify(body.content);
  if (serialized.length > 200_000) {
    return jsonResponse({ ok: false, error: 'Payload too large' }, { status: 413, origin });
  }

  // Sanitize all string fields, then merge with defaults
  const sanitized = sanitizeContentDeep(body.content);
  const merged = mergeDeep(DEFAULT_CONTENT, sanitized);
  await env.CONTENT.put(CONTENT_KEY, JSON.stringify(merged));
  return jsonResponse({ ok: true, content: merged, savedAt: new Date().toISOString() }, { origin });
}
