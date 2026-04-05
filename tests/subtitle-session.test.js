const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSubtitleSources,
  createSubtitleSourceSignature,
  resolveSubtitleSourceUpdate,
} = require('../ott-dual-subs-v2/subtitle-session.js');

test('normalizeSubtitleSources keeps the latest unique subtitle pair', () => {
  const sources = normalizeSubtitleSources(
    [
      'https://cdn.example.com/ep1-ko.vtt',
      'https://cdn.example.com/ep1-en.vtt',
      'https://cdn.example.com/ep2-ko.vtt',
      'https://cdn.example.com/ep2-en.vtt',
    ],
    ['vtt', 'vtt', 'vtt', 'vtt']
  );

  assert.deepEqual(sources, [
    { url: 'https://cdn.example.com/ep2-ko.vtt', format: 'vtt' },
    { url: 'https://cdn.example.com/ep2-en.vtt', format: 'vtt' },
  ]);
});

test('normalizeSubtitleSources removes duplicate URLs before trimming', () => {
  const sources = normalizeSubtitleSources(
    [
      'https://cdn.example.com/ep2-ko.vtt',
      'https://cdn.example.com/ep2-en.vtt',
      'https://cdn.example.com/ep2-ko.vtt',
    ],
    ['vtt', 'ttml', 'vtt']
  );

  assert.deepEqual(sources, [
    { url: 'https://cdn.example.com/ep2-ko.vtt', format: 'vtt' },
    { url: 'https://cdn.example.com/ep2-en.vtt', format: 'ttml' },
  ]);
});

test('resolveSubtitleSourceUpdate marks unchanged subtitle sets correctly', () => {
  const currentSources = normalizeSubtitleSources(
    ['https://cdn.example.com/ep2-ko.vtt', 'https://cdn.example.com/ep2-en.vtt'],
    ['vtt', 'ttml']
  );
  const currentSignature = createSubtitleSourceSignature(currentSources);

  const update = resolveSubtitleSourceUpdate(
    currentSignature,
    [
      'https://cdn.example.com/ep1-ko.vtt',
      'https://cdn.example.com/ep1-en.vtt',
      'https://cdn.example.com/ep2-ko.vtt',
      'https://cdn.example.com/ep2-en.vtt',
    ],
    ['vtt', 'vtt', 'vtt', 'ttml']
  );

  assert.equal(update.changed, false);
  assert.deepEqual(update.sources, currentSources);
});

test('resolveSubtitleSourceUpdate marks active subtitle reloads when episode changes', () => {
  const currentSources = normalizeSubtitleSources(
    ['https://cdn.example.com/ep1-ko.vtt', 'https://cdn.example.com/ep1-en.vtt'],
    ['vtt', 'vtt']
  );
  const currentSignature = createSubtitleSourceSignature(currentSources);

  const update = resolveSubtitleSourceUpdate(
    currentSignature,
    ['https://cdn.example.com/ep2-ko.vtt', 'https://cdn.example.com/ep2-en.vtt'],
    ['vtt', 'vtt']
  );

  assert.equal(update.changed, true);
  assert.deepEqual(update.sources, [
    { url: 'https://cdn.example.com/ep2-ko.vtt', format: 'vtt' },
    { url: 'https://cdn.example.com/ep2-en.vtt', format: 'vtt' },
  ]);
});
