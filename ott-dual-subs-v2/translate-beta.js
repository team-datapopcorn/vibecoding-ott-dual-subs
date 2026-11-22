/**
 * AI 자막 생성·번역 (무료 베타)
 *
 * - 일본어 자막: 영어(없으면 한국어) 자막을 일본어로 번역한다.
 * - 빠진 자막 생성: 한국어 자막만 있으면 영어를, 영어 자막만 있으면 한국어를 만든다.
 * - 자막 줄을 40줄 묶음으로 나눠, 지금 보는 위치의 묶음부터 요청한다.
 * - 콘텐츠 스크립트는 BETA_TRANSLATE 메시지만 보내고, 서버 호출·캐시는 서비스 워커가 맡는다.
 * - 서버(ott-api.datapopcorn.ai)에는 원문 자막 문장, 원문·대상 언어, 무작위 설치 ID, 확장 버전만 보낸다.
 * - 생성한 자막은 이 브라우저의 확장 저장소에 묶음 단위로 저장해 다시 요청하지 않는다.
 */
(function (root) {
  'use strict';

  const API_URL = 'https://ott-api.datapopcorn.ai/v1/translate';
  const CHUNK_SIZE = 40;
  const MAX_LINE_CHARS = 400;
  const CONCURRENCY = 2;
  const MAX_ATTEMPTS = 3;
  const CACHE_PREFIX = 'btc_';
  const CACHE_INDEX = 'btc_index';
  const CACHE_LIMIT = 3000; // 약 120편 × 1개 언어
  const LANGS = {
    ja: { label: '日本語', ko: '일본어' },
    en: { label: 'English', ko: '영어' },
    ko: { label: '한국어', ko: '한국어' },
  };
  const SOURCES = ['en', 'ko'];
  const STOP_CODES = new Set(['USER_LIMIT', 'DAILY_LIMIT', 'UNSUPPORTED_LANG', 'FORBIDDEN_ORIGIN']);

  // 팝업 '위 줄 언어'로 고를 수 있는 AI 언어 (영어 원문은 기본이라 제외)
  function isBetaLang(lang) {
    return lang === 'ja';
  }

  function isPair(src, lang) {
    return SOURCES.includes(src) && Object.prototype.hasOwnProperty.call(LANGS, lang) && src !== lang;
  }

  function hashKey(text) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return h1.toString(36) + h2.toString(36) + text.length.toString(36);
  }

  function cacheKey(lang, lines, src = 'en') {
    // 2.4.0과 같은 키(영어→일본어)를 유지해 이미 받은 번역을 재사용한다.
    const prefix = src === 'en' ? CACHE_PREFIX + lang : CACHE_PREFIX + src + lang;
    return prefix + '_' + hashKey(lines.join('\u241E'));
  }

  function buildChunks(total, size = CHUNK_SIZE) {
    const chunks = [];
    for (let start = 0; start < total; start += size) chunks.push({ start, end: Math.min(total, start + size) });
    return chunks;
  }

  function chunkLines(cues, chunk) {
    return cues.slice(chunk.start, chunk.end).map((cue) => String(cue.text || '').slice(0, MAX_LINE_CHARS));
  }

  // 현재 시각 이후 첫 줄이 든 묶음 → 그 뒤 묶음 → 앞 묶음 순서
  function orderChunks(chunks, cues, time) {
    if (!chunks.length) return [];
    let anchor = cues.findIndex((cue) => cue.endTime > time);
    if (anchor < 0) anchor = cues.length - 1;
    const first = chunks.findIndex((chunk) => anchor >= chunk.start && anchor < chunk.end);
    const from = first < 0 ? 0 : first;
    return chunks.slice(from).concat(chunks.slice(0, from).reverse());
  }

  function createTranslator({ request, onChange = () => {} }) {
    let token = 0;
    let state = { src: '', lang: '', total: 0, done: 0, state: 'idle', code: '' };
    let texts = [];

    function setState(patch) {
      state = { ...state, ...patch };
      onChange(state);
    }

    function stop() {
      token += 1;
      texts = [];
      state = { src: '', lang: '', total: 0, done: 0, state: 'idle', code: '' };
    }

    function start(cues, lang, getTime, src = 'en') {
      stop();
      if (!isPair(src, lang) || !Array.isArray(cues) || cues.length === 0) return;
      const myToken = token;
      const chunks = buildChunks(cues.length);
      const status = chunks.map(() => ({ pending: false, done: false, attempts: 0 }));
      texts = new Array(cues.length).fill(null);
      setState({ src, lang, total: cues.length, done: 0, state: 'working', code: '' });

      function next() {
        const order = orderChunks(chunks, cues, Number(getTime?.()) || 0);
        return order.find((chunk) => {
          const s = status[chunks.indexOf(chunk)];
          return !s.pending && !s.done && s.attempts < MAX_ATTEMPTS;
        });
      }

      async function worker() {
        for (;;) {
          if (myToken !== token || state.state === 'limit') return;
          const chunk = next();
          if (!chunk) return;
          const s = status[chunks.indexOf(chunk)];
          s.pending = true;
          s.attempts += 1;
          let res;
          try { res = await request({ type: 'BETA_TRANSLATE', src, lang, lines: chunkLines(cues, chunk) }); } catch { res = { ok: false, code: 'RUNTIME_ERROR' }; }
          if (myToken !== token) return;
          s.pending = false;
          if (res?.ok && Array.isArray(res.lines) && res.lines.length === chunk.end - chunk.start) {
            s.done = true;
            res.lines.forEach((line, offset) => { texts[chunk.start + offset] = line; });
            const done = state.done + res.lines.length;
            setState({ done, state: done >= cues.length ? 'ready' : 'working' });
          } else if (STOP_CODES.has(res?.code)) {
            setState({ state: 'limit', code: res.code });
            return;
          } else {
            setState({ code: res?.code || 'ERROR' });
            await new Promise((resolve) => setTimeout(resolve, 1500 * s.attempts));
          }
        }
      }

      Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => {
        if (myToken !== token) return;
        if (state.state === 'working') setState({ state: state.done > 0 ? 'partial' : 'error' });
      });
    }

    return {
      start,
      stop,
      textAt: (index) => (index >= 0 && index < texts.length ? texts[index] : null),
      status: () => ({ ...state }),
    };
  }

  // ---- 서비스 워커 쪽 ----
  async function getInstallId(storage) {
    const saved = await storage.get('betaInstallId');
    if (typeof saved.betaInstallId === 'string' && /^[0-9a-f-]{36}$/.test(saved.betaInstallId)) return saved.betaInstallId;
    const id = crypto.randomUUID();
    await storage.set({ betaInstallId: id });
    return id;
  }

  async function rememberCache(storage, key, lines) {
    const saved = await storage.get(CACHE_INDEX);
    const index = Array.isArray(saved[CACHE_INDEX]) ? saved[CACHE_INDEX].filter((k) => k !== key) : [];
    index.push(key);
    const evicted = index.length > CACHE_LIMIT ? index.splice(0, index.length - CACHE_LIMIT) : [];
    await storage.set({ [key]: lines, [CACHE_INDEX]: index });
    if (evicted.length) await storage.remove(evicted);
  }

  async function handleTranslate(message, { storage, fetchImpl, version }) {
    const lang = message?.lang;
    const src = message?.src || 'en';
    const lines = message?.lines;
    if (!isPair(src, lang)) return { ok: false, code: 'UNSUPPORTED_LANG' };
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 60 || lines.some((line) => typeof line !== 'string')) {
      return { ok: false, code: 'BAD_LINES' };
    }
    const safe = lines.map((line) => line.slice(0, MAX_LINE_CHARS));
    const key = cacheKey(lang, safe, src);
    const cached = await storage.get(key);
    if (Array.isArray(cached[key]) && cached[key].length === safe.length) return { ok: true, lines: cached[key], cached: true };

    const iid = await getInstallId(storage);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: version, iid, src, lang, lines: safe }),
        signal: controller.signal,
      });
      let data = null;
      try { data = await response.json(); } catch {}
      if (!response.ok || !data?.ok) return { ok: false, code: data?.code || 'HTTP_' + response.status };
      if (!Array.isArray(data.lines) || data.lines.length !== safe.length) return { ok: false, code: 'BAD_RESPONSE' };
      await rememberCache(storage, key, data.lines);
      return { ok: true, lines: data.lines, cached: false };
    } catch (error) {
      return { ok: false, code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- 콘텐츠 스크립트: 자막 언어 판별 ----
  function detectLang(cues) {
    const sample = (cues || []).slice(0, 30).map((cue) => cue.text).join(' ');
    const hangul = (sample.match(/[\uAC00-\uD7AF]/g) || []).length;
    const kana = (sample.match(/[\u3040-\u30FF]/g) || []).length;
    const latin = (sample.match(/[A-Za-z]/g) || []).length;
    if (hangul > 3 && hangul >= kana) return 'ko';
    if (kana > 3) return 'ja';
    if (latin > 10) return 'en';
    return '';
  }

  // 어떤 줄을 무엇으로 채울지 결정한다. top = 위 줄(영어/일본어), bottom = 아래 줄(한국어)
  function planLines({ koReal, enReal, subLang }) {
    const top = subLang === 'ja' ? 'ja' : 'en';
    let topPlan = null;
    if (top === 'en') topPlan = enReal ? { kind: 'real', from: 'en' } : koReal ? { kind: 'ai', from: 'ko', to: 'en' } : null;
    else topPlan = enReal ? { kind: 'ai', from: 'en', to: 'ja' } : koReal ? { kind: 'ai', from: 'ko', to: 'ja' } : null;
    const bottomPlan = koReal ? { kind: 'real', from: 'ko' } : enReal ? { kind: 'ai', from: 'en', to: 'ko' } : null;
    return { top: topPlan, bottom: bottomPlan };
  }

  const api = {
    API_URL, LANGS, CHUNK_SIZE, isBetaLang, isPair, hashKey, cacheKey, buildChunks, chunkLines, orderChunks,
    createTranslator, handleTranslate, detectLang, planLines,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OTTDualSubsTranslateBeta = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
