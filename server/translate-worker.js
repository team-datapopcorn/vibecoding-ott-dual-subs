/**
 * OTT 이중자막 AI 자막 생성·번역 중계 (Cloudflare Worker: ott-dual-subs-beta)
 *
 * - POST /v1/translate  { v, iid, src: 'en'|'ko' (기본 en), lang: 'ja'|'en'|'ko', lines: string[] (최대 60줄) } → { ok, lines, cached }
 * - GET  /health
 * - 생성한 자막은 D1 subtitle_cache에 (원문 해시 → 번역 줄) 로 저장해, 같은 자막 묶음은 다시 생성하지 않는다.
 *   원문 문장은 저장하지 않고 SHA-256 해시만 키로 쓴다. 번역을 받으려면 같은 원문을 보내야 한다.
 * - 사용량은 D1 usage_daily에 (날짜, 무작위 설치 ID, 원문 언어, 대상 언어)별 숫자만 남긴다. IP는 저장하지 않는다.
 * - 비용 안전장치: 새로 생성하는 줄만 한도에 센다. 설치당 하루 4,000줄, 전체 하루 100,000줄.
 *
 * Bindings: DB (D1 ott-dual-subs-usage), GEMINI_API_KEY (secret)
 */

// 3.1 Flash-Lite는 한→일에서 뜻을 틀린 줄이 있어(2026-11-21 비교) 3.5 Flash-Lite를 쓴다.
const MODEL = 'gemini-3.5-flash-lite';
const PROMPT_VERSION = 'p1';
const NAMES = { en: 'English', ko: 'Korean', ja: 'Japanese' };
const SOURCES = ['en', 'ko'];
const MAX_LINES = 60;
const MAX_LINE_CHARS = 400;
const PER_INSTALL_DAILY_LINES = 4000; // 45분짜리 약 5편
const GLOBAL_DAILY_LINES = 100000; // 하루 약 140편, 추정 비용 하루 5~6달러 이하

function systemPrompt(src, lang) {
  const from = NAMES[src];
  const to = NAMES[lang];
  const extra = lang === 'ja'
    ? '- Keep personal names; write them in katakana when natural. Sound cues like [laughs] become e.g. [笑い]. No romaji.'
    : lang === 'ko'
      ? '- Use natural spoken Korean as in Korean streaming subtitles. Keep names in Korean transliteration. Sound cues like [laughs] become e.g. (웃음).'
      : '- Use natural spoken English as in English streaming subtitles. Romanize Korean names in standard style (e.g. 민수 -> Min-su). Sound cues like (웃음) become e.g. [laughs].';
  return `You translate ${from} TV and movie subtitle lines into natural ${to} subtitles.
Rules:
- Return a JSON array of strings with exactly the same number of items as the input "lines", in the same order. One output item per input item.
- Use neighboring lines as context, but never merge or split items.
- Write concise, natural ${to} as in professional ${to} subtitles. Keep each item about as short as the source.
- Keep a line break inside an item if the input item has one.
${extra}
- No notes, explanations, or extra items. An empty input item becomes an empty string.`;
}

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
  const src = body.src || 'en';
  if (!SOURCES.includes(src) || !Object.prototype.hasOwnProperty.call(NAMES, body.lang) || src === body.lang) return 'UNSUPPORTED_LANG';
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > MAX_LINES) return 'BAD_LINES';
  for (const line of body.lines) {
    if (typeof line !== 'string' || line.length > MAX_LINE_CHARS) return 'BAD_LINES';
  }
  return '';
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function callGemini(env, src, lang, lines) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(src, lang) }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ source: NAMES[src], target: NAMES[lang], lines }) }] }],
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
    `INSERT INTO usage_daily (day, iid, src, lang, requests, lines, cached_lines, chars, in_tokens, out_tokens, errors, version, first_seen, last_seen)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
     ON CONFLICT(day, iid, src, lang) DO UPDATE SET
       requests = requests + 1, lines = lines + ?5, cached_lines = cached_lines + ?6, chars = chars + ?7,
       in_tokens = in_tokens + ?8, out_tokens = out_tokens + ?9, errors = errors + ?10,
       version = ?11, last_seen = ?12`
  ).bind(row.day, row.iid, row.src, row.lang, row.lines, row.cachedLines, row.chars, row.inTokens, row.outTokens, row.errors, row.version, now).run();
}

// 개인정보처리방침: 사용량 카운터 12개월, 생성 자막 캐시는 마지막 사용 후 12개월 보관.
async function pruneOld(env) {
  const cutoffDay = kstDay(Date.now() - 365 * 24 * 3600 * 1000);
  const cutoffIso = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM usage_daily WHERE day < ?1').bind(cutoffDay),
    env.DB.prepare('DELETE FROM limit_events WHERE day < ?1').bind(cutoffDay),
    env.DB.prepare('DELETE FROM subtitle_cache WHERE last_used < ?1').bind(cutoffIso),
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
    if (url.pathname === '/health') return json({ ok: true, service: 'ott-dual-subs-beta', pairs: ['en>ja', 'ko>ja', 'ko>en', 'en>ko'] }, 200, cors);
    if (url.pathname !== '/v1/translate' || request.method !== 'POST') return json({ ok: false, code: 'NOT_FOUND' }, 404, cors);
    if (!/^chrome-extension:\/\//.test(request.headers.get('Origin') || '')) return json({ ok: false, code: 'FORBIDDEN_ORIGIN' }, 403, cors);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, code: 'BAD_REQUEST' }, 400, cors); }
    const invalid = validate(body);
    if (invalid) return json({ ok: false, code: invalid }, 400, cors);

    const day = kstDay();
    const src = body.src || 'en';
    const lang = body.lang;
    const lines = body.lines;
    const version = typeof body.v === 'string' ? body.v.slice(0, 16) : '';
    const chars = lines.reduce((sum, line) => sum + line.length, 0);
    const key = await sha256(`${PROMPT_VERSION}|${MODEL}|${src}>${lang}\n${JSON.stringify(lines)}`);
    const base = { day, iid: body.iid, src, lang, version, chars, inTokens: 0, outTokens: 0, errors: 0 };

    // 1) 이미 만든 자막이면 그대로 돌려준다 (한도·비용 없음).
    const hit = await env.DB.prepare('SELECT lines FROM subtitle_cache WHERE key = ?1').bind(key).first();
    if (hit) {
      let cachedLines = null;
      try { cachedLines = JSON.parse(hit.lines); } catch {}
      if (Array.isArray(cachedLines) && cachedLines.length === lines.length) {
        ctx.waitUntil(Promise.all([
          env.DB.prepare('UPDATE subtitle_cache SET hits = hits + 1, last_used = ?2 WHERE key = ?1').bind(key, new Date().toISOString()).run(),
          record(env, { ...base, lines: 0, cachedLines: lines.length }),
        ]));
        return json({ ok: true, src, lang, lines: cachedLines, cached: true }, 200, cors);
      }
    }

    // 2) 새로 만들 때만 한도를 확인한다.
    const total = await env.DB.prepare('SELECT COALESCE(SUM(lines), 0) AS n FROM usage_daily WHERE day = ?1').bind(day).first();
    if ((total?.n || 0) + lines.length > GLOBAL_DAILY_LINES) {
      ctx.waitUntil(recordLimit(env, day, 'DAILY_LIMIT'));
      return json({ ok: false, code: 'DAILY_LIMIT' }, 429, cors);
    }
    const mine = await env.DB.prepare('SELECT COALESCE(SUM(lines), 0) AS n FROM usage_daily WHERE day = ?1 AND iid = ?2')
      .bind(day, body.iid).first();
    if ((mine?.n || 0) + lines.length > PER_INSTALL_DAILY_LINES) {
      ctx.waitUntil(recordLimit(env, day, 'USER_LIMIT'));
      return json({ ok: false, code: 'USER_LIMIT' }, 429, cors);
    }

    let result = await callGemini(env, src, lang, lines);
    if (!result.ok && result.code !== 'UPSTREAM_400') result = await callGemini(env, src, lang, lines);

    const now = new Date().toISOString();
    const work = [record(env, {
      ...base,
      lines: result.ok ? lines.length : 0, cachedLines: 0, chars: result.ok ? chars : 0,
      inTokens: result.inTokens || 0, outTokens: result.outTokens || 0, errors: result.ok ? 0 : 1,
    })];
    if (result.ok) {
      work.push(env.DB.prepare(
        'INSERT OR IGNORE INTO subtitle_cache (key, src, lang, n, lines, model, created, last_used, hits) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0)'
      ).bind(key, src, lang, lines.length, JSON.stringify(result.lines), MODEL, now).run());
    }
    if (Math.random() < 0.01) work.push(pruneOld(env));
    ctx.waitUntil(Promise.all(work));

    if (!result.ok) return json({ ok: false, code: result.code }, 502, cors);
    return json({ ok: true, src, lang, lines: result.lines, cached: false }, 200, cors);
  },
};
