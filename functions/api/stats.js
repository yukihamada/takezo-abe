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
  const adaptiveQuery = `
    query($zone: String!, $start: Time!, $end: Time!) {
      viewer { zones(filter: {zoneTag: $zone}) {
        totals: httpRequestsAdaptiveGroups(limit: 1, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}) {
          count
          sum { visits edgeResponseBytes }
        }
        byCountry: httpRequestsAdaptiveGroups(limit: 10, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [count_DESC]) {
          count sum { visits } dimensions { clientCountryName }
        }
        byPath: httpRequestsAdaptiveGroups(limit: 15, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}", edgeResponseStatus: 200}, orderBy: [count_DESC]) {
          count dimensions { clientRequestPath }
        }
        byDevice: httpRequestsAdaptiveGroups(limit: 5, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [count_DESC]) {
          count dimensions { clientDeviceType }
        }
        byBrowser: httpRequestsAdaptiveGroups(limit: 8, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [count_DESC]) {
          count dimensions { userAgentBrowser }
        }
        byHour: httpRequestsAdaptiveGroups(limit: 30, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}, orderBy: [datetimeHour_ASC]) {
          count sum { visits } dimensions { datetimeHour }
        }
      } }
    }`;

  // 7 day per-day totals via parallel adaptive queries (each is 24h)
  const dayQueries = [];
  for (let i = 6; i >= 0; i--) {
    const dayEnd = isoBefore(i * 24);
    const dayStart = isoBefore((i + 1) * 24);
    dayQueries.push(gql(token, `
      query($zone: String!, $start: Time!, $end: Time!) {
        viewer { zones(filter: {zoneTag: $zone}) {
          httpRequestsAdaptiveGroups(limit: 1, filter: {datetime_geq: $start, datetime_lt: $end, clientRequestHTTPHost: "${HOST}"}) {
            count sum { visits edgeResponseBytes }
          }
        } }
      }`, { zone, start: dayStart, end: dayEnd })
      .then(r => ({
        date: dateOnly(dayStart),
        ...(r?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0] || { count: 0, sum: { visits: 0, edgeResponseBytes: 0 } })
      })));
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

    return jsonResponse({
      ok: true,
      generatedAt: end,
      host: HOST,
      last24h: {
        totals: z.totals?.[0] || { count: 0, sum: { visits: 0, edgeResponseBytes: 0 } },
        byCountry: z.byCountry || [],
        byPath: z.byPath || [],
        byDevice: z.byDevice || [],
        byBrowser: z.byBrowser || [],
        byHour: z.byHour || []
      },
      last7d: {
        days: days.reduce((acc, d) => {
          const i = acc.findIndex(x => x.date === d.date);
          if (i >= 0) {
            acc[i].requests += d.count || 0;
            acc[i].visits += d.sum?.visits || 0;
            acc[i].bytes += d.sum?.edgeResponseBytes || 0;
          } else {
            acc.push({
              date: d.date,
              requests: d.count || 0,
              visits: d.sum?.visits || 0,
              bytes: d.sum?.edgeResponseBytes || 0
            });
          }
          return acc;
        }, []),
        totals: days.reduce((acc, d) => ({
          requests: acc.requests + (d.count || 0),
          visits: acc.visits + (d.sum?.visits || 0),
          bytes: acc.bytes + (d.sum?.edgeResponseBytes || 0)
        }), { requests: 0, visits: 0, bytes: 0 })
      }
    }, { origin });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, { status: 500, origin });
  }
}
