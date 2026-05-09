// Cloudflare Pages Function: /api/stats
// Returns analytics for takezo.jiuflow.com from CF GraphQL Analytics API.
// Auth: same X-Edit-Password as /api/content.

const HOST = 'takezo.jiuflow.com';

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

async function gql(token, query, variables) {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  return r.json();
}

function isoNow() { return new Date().toISOString(); }
function isoBefore(hours) { return new Date(Date.now() - hours * 3600 * 1000).toISOString(); }
function dateOnly(d) { return d.slice(0, 10); }

// Known bot UA patterns. We can't use botScore on free plan, so we use UA heuristics.
const BOT_UA_PATTERNS = [
  /headless/i,
  /^curl\//i,
  /\bbot\b/i,
  /crawler/i,
  /spider/i,
  /scrapy/i,
  /leakix|l9scan/i,
  /nginx-ssl early hints/i,
  /bastion early hints/i,
  /facebookexternalhit/i,
  /^LINE\//i,
  /line-poker/i,
  /preview/i,
  /\bGo-http-client\b/i,
  /\bpython-requests\b/i,
  /scanner/i,
  /^Mozilla\/5\.0 \(Linux; Android 6\.0; Nexus 5 Build\/MRA58N\)/, // common scanner template
  /SemrushBot|AhrefsBot|MJ12bot|DotBot|YandexBot|Bingbot|Googlebot|Baiduspider/i,
  /GPTBot|ClaudeBot|Bytespider|CCBot|PetalBot|Amazonbot|Applebot/i,
  /^Mozilla\/5\.0 \(Linux; Android 16; SM-F766Q/i, // observed scanner pattern
];
function isLikelyBot(ua) {
  if (!ua) return true;
  return BOT_UA_PATTERNS.some(re => re.test(ua));
}

// Paths that represent actual human page-views.
// Everything else (assets, .well-known/acme-challenge, /api/*, /cdn-cgi/*, /edit/*, /stats/*) is excluded
// from the "human visitor" count so scanners hitting random paths don't inflate the number.
const HUMAN_PAGE_PATHS = new Set(['/', '/en/', '/en']);
function isHumanPagePath(path) {
  return HUMAN_PAGE_PATHS.has(path);
}

export async function onRequestOptions({ request }) {
  return jsonResponse({ ok: true }, { origin: request.headers.get('Origin') || '' });
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get('Origin') || '';

  if (!env.EDIT_PASSWORD) return jsonResponse({ ok: false, error: 'Server misconfigured' }, { status: 500, origin });
  const pw = request.headers.get('X-Edit-Password') || '';
  if (!timingSafeEqual(pw, env.EDIT_PASSWORD)) {
    return jsonResponse({ ok: false, error: 'Invalid password' }, { status: 401, origin });
  }
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID) {
    return jsonResponse({ ok: false, error: 'Analytics token not configured' }, { status: 500, origin });
  }

  const token = env.CF_ANALYTICS_TOKEN;
  const zone = env.CF_ZONE_ID;
  const end = isoNow();
  const start24 = isoBefore(24);

  // Last 24h detailed (one query, multiple aliases)
  // We additionally pull "byUA" (top user agents) and "byUAxHour" / "byUAxCountry" / "byUAxPath" so we can
  // post-process and produce HUMAN-only estimates by excluding known bot UA patterns.
  const adaptiveQuery = `
    query($zone: String!, $start: Time!, $end: Time!) {
      viewer { zones(filter: {zoneTag: $zone}) {
        totals: httpRequestsAdaptiveGroups(limit: 1, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}) {
          count
          sum { visits edgeResponseBytes }
        }
        byUA: httpRequestsAdaptiveGroups(limit: 200, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [count_DESC]) {
          count sum { visits edgeResponseBytes } dimensions { userAgent }
        }
        byUAxCountry: httpRequestsAdaptiveGroups(limit: 200, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [count_DESC]) {
          count sum { visits } dimensions { userAgent clientCountryName }
        }
        byUAxPath: httpRequestsAdaptiveGroups(limit: 200, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}", edgeResponseStatus: 200}, orderBy: [count_DESC]) {
          count dimensions { userAgent clientRequestPath }
        }
        byUAxDevice: httpRequestsAdaptiveGroups(limit: 200, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [count_DESC]) {
          count dimensions { userAgent clientDeviceType }
        }
        byUAxBrowser: httpRequestsAdaptiveGroups(limit: 200, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [count_DESC]) {
          count dimensions { userAgent userAgentBrowser }
        }
        byHour: httpRequestsAdaptiveGroups(limit: 60, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [datetimeHour_ASC]) {
          count sum { visits } dimensions { datetimeHour userAgent }
        }
      } }
    }`;

  // 7 day per-day totals via parallel adaptive queries (each is 24h).
  // We pull broken down by userAgent so we can compute human-only totals.
  const dayQueries = [];
  for (let i = 6; i >= 0; i--) {
    const dayEnd = isoBefore(i * 24);
    const dayStart = isoBefore((i + 1) * 24);
    dayQueries.push(gql(token, `
      query($zone: String!, $start: Time!, $end: Time!) {
        viewer { zones(filter: {zoneTag: $zone}) {
          all: httpRequestsAdaptiveGroups(limit: 200, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [count_DESC]) {
            count sum { visits edgeResponseBytes } dimensions { userAgent }
          }
          pages: httpRequestsAdaptiveGroups(limit: 200, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}", edgeResponseStatus: 200}, orderBy: [count_DESC]) {
            count dimensions { userAgent clientRequestPath }
          }
        } }
      }`, { zone, start: dayStart, end: dayEnd })
      .then(r => {
        const z = r?.data?.viewer?.zones?.[0] || {};
        const rows = z.all || [];
        const pageRows = z.pages || [];
        const all = rows.reduce((acc, x) => ({
          requests: acc.requests + (x.count || 0),
          visits:   acc.visits   + (x.sum?.visits || 0),
          bytes:    acc.bytes    + (x.sum?.edgeResponseBytes || 0)
        }), { requests: 0, visits: 0, bytes: 0 });
        const humanByUA = rows.filter(x => !isLikelyBot(x.dimensions.userAgent)).reduce((acc, x) => ({
          visits: acc.visits + (x.sum?.visits || 0),
          bytes:  acc.bytes  + (x.sum?.edgeResponseBytes || 0)
        }), { visits: 0, bytes: 0 });
        const humanPageRequests = pageRows
          .filter(x => !isLikelyBot(x.dimensions.userAgent) && isHumanPagePath(x.dimensions.clientRequestPath))
          .reduce((acc, x) => acc + (x.count || 0), 0);
        const human = { requests: humanPageRequests, visits: humanByUA.visits, bytes: humanByUA.bytes };
        return { date: dateOnly(dayStart), all, human };
      }));
  }

  try {
    const [adaptive, ...days] = await Promise.all([
      gql(token, adaptiveQuery, { zone, start: start24, end }),
      ...dayQueries
    ]);

    if (adaptive.errors) {
      return jsonResponse({ ok: false, error: 'GraphQL error', details: adaptive.errors }, { status: 502, origin });
    }
    const z = adaptive?.data?.viewer?.zones?.[0] || {};

    // === Aggregate "all" + "human" from UA-keyed rows ===

    const sumRows = (rows, keyDim) => {
      const out = new Map();
      for (const r of rows) {
        const k = r.dimensions[keyDim] || '(unknown)';
        const cur = out.get(k) || { count: 0, visits: 0 };
        cur.count += r.count || 0;
        cur.visits += r.sum?.visits || 0;
        out.set(k, cur);
      }
      return [...out.entries()].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => ({ key: k, ...v }));
    };

    const byUA = z.byUA || [];
    const byUAxPath = z.byUAxPath || [];

    // For "all" total: every request, every UA
    const sumOf = (rows) => rows.reduce((acc, x) => ({
      count: acc.count + (x.count || 0),
      visits: acc.visits + (x.sum?.visits || 0),
      bytes: acc.bytes + (x.sum?.edgeResponseBytes || 0)
    }), { count: 0, visits: 0, bytes: 0 });

    const humanRowsByUA = byUA.filter(x => !isLikelyBot(x.dimensions.userAgent));
    const botRowsByUA   = byUA.filter(x =>  isLikelyBot(x.dimensions.userAgent));

    // For HUMAN totals: only HTML page hits ("/" or "/en/") AND non-bot UA
    // (UA breakdown is from byUAxPath which already restricted to status=200)
    const humanPageRows = byUAxPath.filter(x =>
      !isLikelyBot(x.dimensions.userAgent) &&
      isHumanPagePath(x.dimensions.clientRequestPath)
    );

    const totalsAll   = sumOf(byUA);
    const totalsBot   = sumOf(botRowsByUA);
    // Human totals: requests = page-hits to /, /en/. Visits = sum.visits from byUA filtered.
    // (We use humanRowsByUA's visits because adaptive doesn't have visits per (UA,path) — visits is a session metric.)
    const totalsHumanPages = humanPageRows.reduce((acc, x) => ({
      count: acc.count + (x.count || 0)
    }), { count: 0 });
    const totalsHumanByUA = sumOf(humanRowsByUA);
    const totalsHuman = {
      count: totalsHumanPages.count,        // request count = HTML page views by humans
      visits: totalsHumanByUA.visits,       // visits = CF-estimated session count from non-bot UAs
      bytes: totalsHumanByUA.bytes
    };

    // helper to aggregate by a dimension keyed by another dim, with optional UA + path filters.
    // For "human" mode we additionally require path = "/" or "/en/" if pathDim is provided in the row.
    const aggBy = (rows, dim, humanOnly = false) => {
      let filtered = rows;
      if (humanOnly) {
        filtered = filtered.filter(r => !isLikelyBot(r.dimensions.userAgent));
        // If row has a path dim, require it to be a real page
        filtered = filtered.filter(r => {
          const p = r.dimensions.clientRequestPath;
          return p === undefined || isHumanPagePath(p);
        });
      }
      return sumRows(filtered, dim);
    };

    const last24hAll = {
      totals: { count: totalsAll.count, sum: { visits: totalsAll.visits, edgeResponseBytes: totalsAll.bytes } },
      byCountry: aggBy(z.byUAxCountry || [], 'clientCountryName').map(r => ({ count: r.count, sum: { visits: r.visits }, dimensions: { clientCountryName: r.key } })).slice(0, 10),
      byPath:    aggBy(z.byUAxPath || [],    'clientRequestPath').map(r => ({ count: r.count, dimensions: { clientRequestPath: r.key } })).slice(0, 15),
      byDevice:  aggBy(z.byUAxDevice || [],  'clientDeviceType').map(r => ({ count: r.count, dimensions: { clientDeviceType: r.key } })).slice(0, 5),
      byBrowser: aggBy(z.byUAxBrowser || [], 'userAgentBrowser').map(r => ({ count: r.count, dimensions: { userAgentBrowser: r.key } })).slice(0, 8),
      byHour: (() => {
        const m = new Map();
        for (const r of (z.byHour || [])) {
          const h = r.dimensions.datetimeHour;
          const cur = m.get(h) || { count: 0, visits: 0 };
          cur.count += r.count || 0;
          cur.visits += r.sum?.visits || 0;
          m.set(h, cur);
        }
        return [...m.entries()].sort((a,b) => a[0] < b[0] ? -1 : 1).map(([h, v]) => ({ count: v.count, sum: { visits: v.visits }, dimensions: { datetimeHour: h } }));
      })()
    };

    const last24hHuman = {
      totals: { count: totalsHuman.count, sum: { visits: totalsHuman.visits, edgeResponseBytes: totalsHuman.bytes } },
      _note: 'リクエスト数は / と /en/ への HTML 表示のみ集計。アセット・スキャナ的パスは除外。',
      byCountry: aggBy(z.byUAxCountry || [], 'clientCountryName', true).map(r => ({ count: r.count, sum: { visits: r.visits }, dimensions: { clientCountryName: r.key } })).slice(0, 10),
      byPath:    aggBy(z.byUAxPath || [],    'clientRequestPath', true).map(r => ({ count: r.count, dimensions: { clientRequestPath: r.key } })).slice(0, 15),
      byDevice:  aggBy(z.byUAxDevice || [],  'clientDeviceType', true).map(r => ({ count: r.count, dimensions: { clientDeviceType: r.key } })).slice(0, 5),
      byBrowser: aggBy(z.byUAxBrowser || [], 'userAgentBrowser', true).map(r => ({ count: r.count, dimensions: { userAgentBrowser: r.key } })).slice(0, 8),
      byHour: (() => {
        const m = new Map();
        for (const r of (z.byHour || [])) {
          if (isLikelyBot(r.dimensions.userAgent)) continue;
          const h = r.dimensions.datetimeHour;
          const cur = m.get(h) || { count: 0, visits: 0 };
          cur.count += r.count || 0;
          cur.visits += r.sum?.visits || 0;
          m.set(h, cur);
        }
        return [...m.entries()].sort((a,b) => a[0] < b[0] ? -1 : 1).map(([h, v]) => ({ count: v.count, sum: { visits: v.visits }, dimensions: { datetimeHour: h } }));
      })()
    };

    // Top bot sources for transparency
    const topBots = sumRows(botRowsByUA, 'userAgent').slice(0, 10).map(r => ({ ua: r.key, count: r.count, visits: r.visits }));

    // 7-day series — both views
    const reduceDays = (key) => days.reduce((acc, d) => {
      const ex = acc.find(x => x.date === d.date);
      const v = d[key];
      if (ex) {
        ex.requests += v.requests; ex.visits += v.visits; ex.bytes += v.bytes;
      } else {
        acc.push({ date: d.date, requests: v.requests, visits: v.visits, bytes: v.bytes });
      }
      return acc;
    }, []);
    const sumDays = (key) => days.reduce((acc, d) => ({
      requests: acc.requests + d[key].requests,
      visits: acc.visits + d[key].visits,
      bytes: acc.bytes + d[key].bytes
    }), { requests: 0, visits: 0, bytes: 0 });

    return jsonResponse({
      ok: true,
      generatedAt: end,
      host: HOST,
      botFilter: { method: 'user-agent-heuristic', note: '無料プランのため Cloudflare Bot Score は使用不可。UAパターンで除外。' },
      last24h: last24hAll,
      last24h_human: last24hHuman,
      last24h_bots:  { totals: { count: totalsBot.count, sum: { visits: totalsBot.visits, edgeResponseBytes: totalsBot.bytes } }, top: topBots },
      last7d:        { days: reduceDays('all'),   totals: sumDays('all') },
      last7d_human:  { days: reduceDays('human'), totals: sumDays('human') }
    }, { origin });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, { status: 500, origin });
  }
}
