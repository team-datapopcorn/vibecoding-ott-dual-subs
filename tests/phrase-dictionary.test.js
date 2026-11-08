const test = require('node:test');
const assert = require('node:assert/strict');
const dictionary = require('../ott-dual-subs-v2/phrase-dictionary.js');

function makeArea(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(key) {
      if (typeof key === 'string') return { [key]: values.get(key) };
      return Object.fromEntries(values.entries());
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    _values: values,
  };
}

function phrase(expression, overrides = {}) {
  return {
    expression,
    meaning: `${expression}의 뜻`,
    annotation: `${expression}이 문맥에서 쓰인 방식`,
    ...overrides,
  };
}

function explanation(phrases) { return { phrases }; }

test('normalizes depth and exposes a reusable reviewed seed set', () => {
  assert.equal(dictionary.normalizeDepth(' STRONG '), 'strong');
  assert.equal(dictionary.normalizeDepth('weak'), 'weak');
  assert.equal(dictionary.normalizeDepth('unknown'), 'medium');
  assert.equal(dictionary.normalizeDepth(), 'medium');
  assert.ok(dictionary.BUILTIN_ENTRIES.length >= 15);
  assert.ok(dictionary.BUILTIN_ENTRIES.some((entry) => entry.expression === 'has been leading' && entry.kind === 'common'));
  assert.ok(dictionary.BUILTIN_ENTRIES.some((entry) => entry.expression === 'paramilitary offshoot' && entry.kind === 'term'));
  assert.ok(dictionary.BUILTIN_ENTRIES.some((entry) => entry.expression === 'hi' && entry.kind === 'common'));
});

test('matches common chunks across sentences, inflection aliases, and word boundaries', () => {
  const entries = dictionary.BUILTIN_ENTRIES;
  const first = dictionary.planGeneration(entries, { english: 'Please make sure we have a plan.' }, 'medium');
  const second = dictionary.planGeneration(entries, { english: 'She made sure the door was locked.' }, 'medium');
  assert.equal(first.reused[0].expression, 'make sure');
  assert.equal(first.reused[0].matchedExpression, 'make sure');
  assert.equal(second.reused[0].expression, 'make sure');
  assert.equal(second.reused[0].matchedExpression, 'made sure');
  assert.equal(dictionary.planGeneration(entries, { english: 'The intelligence report arrived.' }, 'strong').reused.length, 0);
  assert.equal(dictionary.planGeneration(entries, { english: 'Intel arrived with the team.' }, 'medium').reused.length, 0);
  assert.equal(dictionary.planGeneration(entries, { english: 'The team has been leading the effort.' }, 'medium').reused[0].expression, 'has been leading');
});

test('guards ambiguous run into senses and does not reuse unknown evidence', () => {
  const entries = dictionary.BUILTIN_ENTRIES;
  const person = dictionary.planGeneration(entries, { english: 'I ran into Sarah.', korean: '우연히 만났어.' }, 'strong');
  const problem = dictionary.planGeneration(entries, { english: 'We ran into a problem.', korean: '문제가 생겼어.' }, 'strong');
  const unknown = dictionary.planGeneration(entries, { english: 'We ran into a problem.' }, 'strong');
  assert.equal(person.reused[0].sense, 'person');
  assert.equal(problem.reused[0].sense, 'problem');
  assert.equal(unknown.reused.length, 0);
  assert.equal(unknown.eligible, true);
});

test('strong can reuse seeded greetings while medium and weak skip them', () => {
  const entries = dictionary.BUILTIN_ENTRIES;
  assert.equal(dictionary.planGeneration(entries, { english: 'Hi!' }, 'strong').reused[0].expression, 'hi');
  assert.equal(dictionary.planGeneration(entries, { english: 'Hi!' }, 'medium').reused.length, 0);
  assert.equal(dictionary.planGeneration(entries, { english: 'Hi!' }, 'medium').candidates.length, 0);
  assert.equal(dictionary.planGeneration(entries, { english: 'Hi!' }, 'weak').reused.length, 0);
});

test('depth policy keeps medium conservative and weak terminology-only', () => {
  const entries = dictionary.BUILTIN_ENTRIES;
  const mixed = dictionary.planGeneration(entries, {
    english: 'The actionable intel comes with a tight clock.',
    korean: '정보를 입수했는데 시간이 촉박해.',
  }, 'medium');
  assert.equal(mixed.reused.every((entry) => entry.kind === 'common'), true);
  assert.equal(mixed.reused.some((entry) => entry.expression === 'actionable intel'), false);
  assert.equal(mixed.candidates.length, 0);
  const weak = dictionary.planGeneration(entries, {
    english: 'The actionable intel comes with a tight clock.',
    korean: '정보를 입수했는데 시간이 촉박해.',
  }, 'weak');
  assert.equal(weak.reused.every((entry) => entry.kind === 'term'), true);
  assert.equal(weak.reused.some((entry) => entry.expression === 'actionable intel'), true);
  assert.equal(weak.reused.some((entry) => entry.kind === 'common'), false);
  const pureTermMedium = dictionary.planGeneration(entries, { english: 'The paramilitary offshoot moved.' }, 'medium');
  assert.equal(pureTermMedium.reused.length, 0);
  assert.equal(pureTermMedium.candidates.length, 0);
  const noApiCandidate = dictionary.planGeneration(entries, { english: 'We faced an unexpected setback.' }, 'strong');
  assert.deepEqual(noApiCandidate.candidates, []);
  assert.equal(noApiCandidate.eligible, true);
});

test('learned entries persist across store restarts and reuse stats are persisted', async () => {
  const area = makeArea();
  const store = dictionary.createStore(area);
  const saved = await store.remember(explanation([phrase('ran into', { aliases: ['run into'] })]), {
    english: 'We ran into a problem.',
    korean: '문제가 생겼어.',
  });
  assert.equal(saved.saved.length, 1);
  const first = await store.lookup({ english: 'They ran into trouble.', korean: '문제가 생겼다.' }, 'strong');
  assert.equal(first.reused[0].sense, 'problem');
  assert.equal(first.reused[0].matchedExpression, 'ran into');
  assert.equal((await store.stats()).reuses, 1);
  const restarted = dictionary.createStore(area);
  const second = await restarted.lookup({ english: 'We ran into delays.', korean: '문제가 생겼다.' }, 'strong');
  assert.equal(second.reused.length, 1);
  assert.equal((await restarted.stats()).learned, 1);
  assert.equal((await restarted.stats()).reuses, 2);
});

test('remember rejects absent or malformed expressions, avoids duplicates, and does not guess arbitrary words', async () => {
  const store = dictionary.createStore(makeArea());
  const context = { english: 'We faced an unexpected setback.', korean: '예상치 못한 난관을 만났어.' };
  const first = await store.remember(explanation([
    phrase('unexpected setback'),
    phrase('not in this line'),
    phrase('<b>bad</b>'),
    phrase('setback', { kind: 'unknown' }),
  ]), context);
  assert.equal(first.saved.length, 1);
  assert.equal(first.rejected.length, 3);
  const second = await store.remember(explanation([phrase('unexpected setback')]), context);
  assert.equal(second.saved.length, 1);
  assert.equal((await store.stats()).learned, 1);
});

test('serializes concurrent writes, caps learned entries without silent deletion, and supports list/remove', async () => {
  const area = makeArea();
  const store = dictionary.createStore(area);
  const contexts = [
    { english: 'We solved the blue car problem.', korean: '문제를 해결했어.' },
    { english: 'They solved the red boat problem.', korean: '문제를 해결했어.' },
  ];
  await Promise.all(contexts.map((context, index) => store.remember(explanation([phrase(index === 0 ? 'blue car problem' : 'red boat problem')]), context)));
  assert.equal((await store.stats()).learned, 2);
  const listed = await store.list({ query: 'blue car', limit: 10 });
  assert.equal(listed.total, 1);
  assert.equal(listed.entries[0].source, 'ai');
  const removable = listed.entries[0];
  assert.deepEqual(await store.remove(removable.id), { ok: true, removed: true, reason: undefined });
  assert.equal((await store.stats()).learned, 1);
  const builtinId = dictionary.BUILTIN_ENTRIES[0].id;
  const cannotRemove = await store.remove(builtinId);
  assert.equal(cannotRemove.removed, false);

  const almostFull = [];
  for (let index = 0; index < dictionary.MAX_LEARNED - 1; index += 1) {
    almostFull.push({
      id: `learned-${index}`,
      expression: `phrase ${index}`,
      aliases: [],
      meaning: '저장된 표현', note: '', kind: 'common', sense: '', contextHints: [],
      source: 'ai', uses: 0, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    });
  }
  area._values.set(dictionary.STORAGE_KEY, { version: 1, entries: almostFull, stats: { reuses: 0 } });
  const fullResult = await store.remember(explanation([phrase('last phrase')]), { english: 'This is the last phrase.', korean: '' });
  assert.equal(fullResult.full, true);
  assert.equal(fullResult.saved.length, 1);
  const stillFull = await store.remember(explanation([phrase('one more phrase')]), { english: 'This is one more phrase.', korean: '' });
  assert.equal(stillFull.saved.length, 0);
  assert.equal(stillFull.rejected[0].reason, 'CAP_REACHED');
  assert.equal((await store.stats()).learned, dictionary.MAX_LEARNED);
});

test('run into collision and problem contexts never pick the meet-person meaning',()=>{
 const p=dictionary.planGeneration(dictionary.BUILTIN_ENTRIES,{english:'We ran into a problem.',korean:'문제에 부딪혔어.'},'strong');assert.equal(p.reused[0].sense,'problem');
 const wall=dictionary.planGeneration(dictionary.BUILTIN_ENTRIES,{english:'He ran into the wall.',korean:'벽에 부딪혔어.'},'strong');assert.equal(wall.reused.length,0);
});
test('work out exercise and solution senses stay separate, unknown context is not reused',()=>{
 const entries=dictionary.BUILTIN_ENTRIES;
 assert.equal(dictionary.planGeneration(entries,{english:'We worked out yesterday.',korean:'어제 운동했어.'},'medium').reused[0].sense,'exercise');
 assert.equal(dictionary.planGeneration(entries,{english:'It worked out.',korean:'잘 풀렸어.'},'medium').reused[0].sense,'solve');
 assert.equal(dictionary.planGeneration(entries,{english:'It worked out.'},'medium').reused.length,0);
 assert.equal(dictionary.planGeneration(entries,{english:'Intel is hiring.'},'strong').reused.length,0);
});
test('dictionary read failures propagate rather than pretending the saved dictionary was empty',async()=>{
 const store=dictionary.createStore({async get(){throw Error('storage unavailable')},async set(){}});
 await assert.rejects(()=>store.lookup({english:'A novel phrase.'},'strong'),/storage unavailable/);
});
test('reuse hits update a compact counter instead of rewriting all phrase data',async()=>{
 const area=makeArea();const writes=[];const orig=area.set;area.set=async v=>{writes.push(v);await orig(v);};
 const store=dictionary.createStore(area);await store.lookup({english:'Please make sure.'},'medium');
 assert.equal(writes.length,1);assert.equal(Object.hasOwn(writes[0],dictionary.STORAGE_KEY),false);assert.equal((await store.stats()).reuses,1);
});
