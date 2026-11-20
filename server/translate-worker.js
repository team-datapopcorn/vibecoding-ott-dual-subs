/**
 * OTT 이중자막 무료 베타 번역 중계 (Cloudflare Worker: ott-dual-subs-beta)
 *
 * - POST /v1/translate  { v, iid, lang: 'ja', lines: string[] (최대 60줄) } → { ok, lines }
 * - GET  /health
 * - 확장은 영어 자막 문장만 보낸다. 서버는 문장·번역문·IP를 저장하지 않는다.
 * - 사용량은 D1 usage_daily에 (날짜, 무작위 설치 ID, 언어)별 횟수·줄 수·토큰 수만 남긴다.
 * - 비용 안전장치: 설치당 하루 줄 수 한도, 전체 하루 줄 수 한도. 한도 초과 시 429.
 *
 * Bindings: DB (D1 ott-dual-subs-usage), GEMINI_API_KEY (secret)
 */

const MODEL = 'gemini-3.1-flash-lite';
const LANGS = { ja: 'Japanese' };
const MAX_LINES = 60;
const MAX_LINE_CHARS = 400;
const PER_INSTALL_DAILY_LINES = 4000; // 45분짜리 약 5편
const GLOBAL_DAILY_LINES = 100000; // 하루 약 140편, 추정 비용 하루 3~4달러 이하

const SYSTEM_PROMPT = `You translate English TV and movie subtitle lines into natural {LANG} subtitles.
Rules:
- Return a JSON array of strings with exactly the same number of items as the input "lines", in the same order. One output item per input item.
- Use neighboring lines as context, but never merge or split items.
- Write concise, natural {LANG} as in professional {LANG} subtitles. Use standard punctuation for that language.
- Keep a line break inside an item if the input item has one.
- Keep personal names; write them in katakana when natural for Japanese.
- Sound or music cues like [laughs] or ♪ lyrics: translate briefly, e.g. [笑い].
- No romaji, notes, explanations, or extra items. An empty input item becomes an empty string.`;

function corsHeaders(origin) {
  const allowed = /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed || 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

function kstDay(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function validate(body) {
  if (!body || typeof body !== 'object') return 'BAD_REQUEST';
  if (typeof body.iid !== 'string' || !/^[0-9a-f-]{36}$/.test(body.iid)) return 'BAD_INSTALL_ID';
  if (!Object.prototype.hasOwnProperty.call(LANGS, body.lang)) return 'UNSUPPORTED_LANG';
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > MAX_LINES) return 'BAD_LINES';
  for (const line of body.lines) {
    if (typeof line !== 'string' || line.length > MAX_LINE_CHARS) return 'BAD_LINES';
  }
  return '';
}

async function callGemini(env, lang, lines) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT.replaceAll('{LANG}', LANGS[lang]) }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ target: LANGS[lang], lines }) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
        temperature: 0.2,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    }),
  });
  if (!response.ok) return { ok: false, code: 'UPSTREAM_' + response.status };
  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
  let out;
  try { out = JSON.parse(text); } catch { return { ok: false, code: 'UPSTREAM_PARSE' }; }
  if (!Array.isArray(out) || out.length !== lines.length || out.some((item) => typeof item !== 'string')) {
    return { ok: false, code: 'UPSTREAM_SHAPE' };
  }
  return {
    ok: true,
    lines: out.map((item, index) => (lines[index].trim() === '' ? '' : item)),
    inTokens: data.usageMetadata?.promptTokenCount || 0,
    outTokens: (data.usageMetadata?.candidatesTokenCount || 0) + (data.usageMetadata?.thoughtsTokenCount || 0),
  };
}

async function record(env, row) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO usage_daily (day, iid, lang, requests, lines, chars, in_tokens, out_tokens, errors, version, first_seen, last_seen)
     VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT(day, iid, lang) DO UPDATE SET
       requests = requests + 1, lines = lines + ?4, chars = chars + ?5,
       in_tokens = in_tokens + ?6, out_tokens = out_tokens + ?7, errors = errors + ?8,
       version = ?9, last_seen = ?10`
  ).bind(row.day, row.iid, row.lang, row.lines, row.chars, row.inTokens, row.outTokens, row.errors, row.version, now).run();
}

// 개인정보처리방침: 사용량 카운터는 최대 12개월 보관. 요청 100번에 한 번꼴로 오래된 행을 지운다.
async function pruneOld(env) {
  const cutoff = kstDay(Date.now() - 365 * 24 * 3600 * 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM usage_daily WHERE day < ?1').bind(cutoff),
    env.DB.prepare('DELETE FROM limit_events WHERE day < ?1').bind(cutoff),
  ]);
}

async function recordLimit(env, day, code) {
  await env.DB.prepare(
    'INSERT INTO limit_events (day, code, count) VALUES (?1, ?2, 1) ON CONFLICT(day, code) DO UPDATE SET count = count + 1'
  ).bind(day, code).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin') || '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health') return json({ ok: true, service: 'ott-dual-subs-beta', langs: Object.keys(LANGS) }, 200, cors);
    if (url.pathname !== '/v1/translate' || request.method !== 'POST') return json({ ok: false, code: 'NOT_FOUND' }, 404, cors);
    if (!/^chrome-extension:\/\//.test(request.headers.get('Origin') || '')) return json({ ok: false, code: 'FORBIDDEN_ORIGIN' }, 403, cors);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, code: 'BAD_REQUEST' }, 400, cors); }
    const invalid = validate(body);
    if (invalid) return json({ ok: false, code: invalid }, 400, cors);

    const day = kstDay();
    const lines = body.lines;
    const version = typeof body.v === 'string' ? body.v.slice(0, 16) : '';

    const total = await env.DB.prepare('SELECT COALESCE(SUM(lines), 0) AS n FROM usage_daily WHERE day = ?1').bind(day).first();
    if ((total?.n || 0) + lines.length > GLOBAL_DAILY_LINES) {
      ctx.waitUntil(recordLimit(env, day, 'DAILY_LIMIT'));
      return json({ ok: false, code: 'DAILY_LIMIT' }, 429, cors);
    }
    const mine = await env.DB.prepare('SELECT lines FROM usage_daily WHERE day = ?1 AND iid = ?2 AND lang = ?3')
      .bind(day, body.iid, body.lang).first();
    if ((mine?.lines || 0) + lines.length > PER_INSTALL_DAILY_LINES) {
      ctx.waitUntil(recordLimit(env, day, 'USER_LIMIT'));
      return json({ ok: false, code: 'USER_LIMIT' }, 429, cors);
    }

    let result = await callGemini(env, body.lang, lines);
    if (!result.ok && result.code !== 'UPSTREAM_400') result = await callGemini(env, body.lang, lines);

    const chars = lines.reduce((sum, line) => sum + line.length, 0);
    ctx.waitUntil(record(env, {
      day, iid: body.iid, lang: body.lang, version,
      lines: result.ok ? lines.length : 0, chars: result.ok ? chars : 0,
      inTokens: result.inTokens || 0, outTokens: result.outTokens || 0, errors: result.ok ? 0 : 1,
    }));

    if (Math.random() < 0.01) ctx.waitUntil(pruneOld(env));

    if (!result.ok) return json({ ok: false, code: result.code }, 502, cors);
    return json({ ok: true, lang: body.lang, lines: result.lines }, 200, cors);
  },
};
