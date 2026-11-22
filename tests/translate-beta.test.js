const test = require('node:test');
const assert = require('node:assert/strict');
const beta = require('../ott-dual-subs-v2/translate-beta.js');

const cues = Array.from({ length: 95 }, (_, i) => ({ startTime: i * 2, endTime: i * 2 + 1.5, text: `line ${i}` }));

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(key) { return key in data ? { [key]: data[key] } : {}; },
    async set(obj) { Object.assign(data, obj); },
    async remove(keys) { for (const key of [].concat(keys)) delete data[key]; },
  };
}

test('only Japanese is offered as a top-line choice; generation pairs are limited', () => {
  assert.equal(beta.isBetaLang('ja'), true);
  assert.equal(beta.isBetaLang('en'), false);
  assert.equal(beta.isBetaLang('es'), false);
  assert.equal(beta.isPair('ko', 'en'), true);
  assert.equal(beta.isPair('ko', 'ja'), true);
  assert.equal(beta.isPair('en', 'ko'), true);
  assert.equal(beta.isPair('ko', 'ko'), false);
  assert.equal(beta.isPair('ja', 'en'), false);
});

test('Korean-only content gets AI English on top and real Korean below', () => {
  assert.deepEqual(beta.planLines({ koReal: true, enReal: false, subLang: 'en' }), { top: { kind: 'ai', from: 'ko', to: 'en' }, bottom: { kind: 'real', from: 'ko' } });
  assert.deepEqual(beta.planLines({ koReal: true, enReal: false, subLang: 'ja' }), { top: { kind: 'ai', from: 'ko', to: 'ja' }, bottom: { kind: 'real', from: 'ko' } });
});

test('English-only content gets AI Korean below; both real means no AI unless Japanese', () => {
  assert.deepEqual(beta.planLines({ koReal: false, enReal: true, subLang: 'en' }), { top: { kind: 'real', from: 'en' }, bottom: { kind: 'ai', from: 'en', to: 'ko' } });
  assert.deepEqual(beta.planLines({ koReal: true, enReal: true, subLang: 'en' }), { top: { kind: 'real', from: 'en' }, bottom: { kind: 'real', from: 'ko' } });
  assert.deepEqual(beta.planLines({ koReal: true, enReal: true, subLang: 'ja' }).top, { kind: 'ai', from: 'en', to: 'ja' });
  assert.deepEqual(beta.planLines({ koReal: false, enReal: false, subLang: 'en' }), { top: null, bottom: null });
});

test('detects subtitle language from cue text', () => {
  assert.equal(beta.detectLang([{ text: '안녕하세요, 반갑습니다.' }]), 'ko');
  assert.equal(beta.detectLang([{ text: 'Hello there, nice to meet you.' }]), 'en');
  assert.equal(beta.detectLang([{ text: 'こんにちは、はじめまして。' }]), 'ja');
  assert.equal(beta.detectLang([{ text: '♪' }]), '');
});

test('chunks cover every line once', () => {
  const chunks = beta.buildChunks(95, 40);
  assert.deepEqual(chunks, [{ start: 0, end: 40 }, { start: 40, end: 80 }, { start: 80, end: 95 }]);
});

test('translation starts from the chunk being watched, then goes forward, then back', () => {
  const chunks = beta.buildChunks(95, 40);
  assert.deepEqual(beta.orderChunks(chunks, cues, 100).map((c) => c.start), [40, 80, 0]);
  assert.deepEqual(beta.orderChunks(chunks, cues, 0).map((c) => c.start), [0, 40, 80]);
  assert.deepEqual(beta.orderChunks(chunks, cues, 9999).map((c) => c.start), [80, 40, 0]);
});

test('cache keys depend on language and exact lines', () => {
  const a = beta.cacheKey('ja', ['a', 'b']);
  assert.equal(a, beta.cacheKey('ja', ['a', 'b']));
  assert.notEqual(a, beta.cacheKey('ja', ['ab']));
  assert.notEqual(a, beta.cacheKey('ja', ['a', 'c']));
  assert.match(a, /^btc_ja_/);
  assert.notEqual(a, beta.cacheKey('ja', ['a', 'b'], 'ko'));
  assert.match(beta.cacheKey('en', ['a'], 'ko'), /^btc_koen_/);
});

test('translator fills lines and reports progress', async () => {
  const requests = [];
  const translator = beta.createTranslator({
    request: async (message) => { requests.push(message); return { ok: true, lines: message.lines.map((l) => 'JA ' + l) }; },
  });
  translator.start(cues, 'ja', () => 100);
  assert.equal(translator.textAt(50), null);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(translator.textAt(50), 'JA line 50');
  assert.equal(translator.textAt(94), 'JA line 94');
  assert.equal(translator.status().state, 'ready');
  assert.equal(translator.status().done, 95);
  assert.equal(requests[0].lines[0], 'line 40');
  assert.ok(requests.every((r) => r.type === 'BETA_TRANSLATE' && r.lang === 'ja' && r.lines.length <= 40));
});

test('translator sends the source language for Korean-only generation', async () => {
  const seen = [];
  const translator = beta.createTranslator({ request: async (m) => { seen.push(m); return { ok: true, lines: m.lines.map(() => 'EN') }; } });
  translator.start(cues.slice(0, 5), 'en', () => 0, 'ko');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seen[0].src, 'ko');
  assert.equal(seen[0].lang, 'en');
  assert.equal(translator.status().state, 'ready');
});

test('translator stops at the daily limit and keeps English fallback', async () => {
  const translator = beta.createTranslator({ request: async () => ({ ok: false, code: 'USER_LIMIT' }) });
  translator.start(cues, 'ja', () => 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(translator.status().state, 'limit');
  assert.equal(translator.textAt(0), null);
});

test('stop discards late responses', async () => {
  let release;
  const translator = beta.createTranslator({ request: () => new Promise((resolve) => { release = resolve; }) });
  translator.start(cues, 'ja', () => 0);
  translator.stop();
  release({ ok: true, lines: cues.slice(0, 40).map(() => 'late') });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(translator.textAt(0), null);
  assert.equal(translator.status().lang, '');
});

test('service worker handler caches results and sends only lines, lang, version and install id', async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, lines: ['こんにちは'] }) };
  };
  const first = await beta.handleTranslate({ lang: 'ja', lines: ['Hello'] }, { storage, fetchImpl, version: '2.4.0' });
  assert.deepEqual(first, { ok: true, lines: ['こんにちは'], cached: false });
  const second = await beta.handleTranslate({ lang: 'ja', lines: ['Hello'] }, { storage, fetchImpl, version: '2.4.0' });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, beta.API_URL);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['iid', 'lang', 'lines', 'src', 'v']);
  assert.equal(calls[0].body.src, 'en');
  assert.match(calls[0].body.iid, /^[0-9a-f-]{36}$/);
});

test('service worker handler rejects bad input and surfaces server codes', async () => {
  const storage = memoryStorage();
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ ok: false, code: 'DAILY_LIMIT' }) });
  assert.equal((await beta.handleTranslate({ lang: 'es', lines: ['x'] }, { storage, fetchImpl })).code, 'UNSUPPORTED_LANG');
  assert.equal((await beta.handleTranslate({ lang: 'ja', lines: [] }, { storage, fetchImpl })).code, 'BAD_LINES');
  assert.equal((await beta.handleTranslate({ lang: 'ja', lines: ['x'] }, { storage, fetchImpl })).code, 'DAILY_LIMIT');
});
