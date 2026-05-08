// Cloudflare Pages Function: /api/content
// GET  → returns the current content JSON
// POST → updates the content JSON (requires X-Edit-Password header)

const CONTENT_KEY = 'site-content-v1';

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

async function getContent(env) {
  if (!env.CONTENT) return DEFAULT_CONTENT;
  const stored = await env.CONTENT.get(CONTENT_KEY, 'json');
  return stored || DEFAULT_CONTENT;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Password'
    }
  });
}

export async function onRequestOptions() {
  return jsonResponse({ ok: true });
}

export async function onRequestGet({ env }) {
  const content = await getContent(env);
  return jsonResponse({ ok: true, content });
}

export async function onRequestPost({ request, env }) {
  const password = request.headers.get('X-Edit-Password') || '';
  if (!env.EDIT_PASSWORD) {
    return jsonResponse({ ok: false, error: 'Server misconfigured: EDIT_PASSWORD not set' }, 500);
  }
  if (password !== env.EDIT_PASSWORD) {
    return jsonResponse({ ok: false, error: 'Invalid password' }, 401);
  }
  if (!env.CONTENT) {
    return jsonResponse({ ok: false, error: 'KV not bound' }, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400); }

  if (!body || typeof body !== 'object' || !body.content) {
    return jsonResponse({ ok: false, error: 'Missing content' }, 400);
  }

  // Merge with defaults to keep schema integrity
  const merged = mergeDeep(DEFAULT_CONTENT, body.content);
  await env.CONTENT.put(CONTENT_KEY, JSON.stringify(merged));
  return jsonResponse({ ok: true, content: merged, savedAt: new Date().toISOString() });
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
