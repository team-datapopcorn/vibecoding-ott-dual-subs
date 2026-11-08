/* Self-contained phrase dictionary for OTT dual-subtitle study explanations. */
(function attachDictionary(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OTTDualSubsDictionary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function phraseDictionary(root) {
  'use strict';

  const STORAGE_KEY = 'studyPhraseDictionaryV1';
  const SCHEMA_VERSION = 1;
  const MAX_LEARNED = 2000;
  const MAX_REUSED = 2;
  const MAX_TEXT = 500;
  const COMMON = 'common';
  const TERM = 'term';

  const safeInflectionPairs = new Set();
  const termLexicon = [
    'actionable intel', 'intel', 'paramilitary offshoot', 'cpr', 'triage',
    'extraction point', 'chain of command', 'safe house', 'surveillance',
    'jurisdiction', 'due process', 'blood pressure', 'heart rate',
    'crime scene', 'evidence locker', 'alibi', 'forensic evidence',
    'command center', 'operational security', 'rules of engagement',
  ];
  const commonPatterns = [
    'comes with', 'come with', 'came with', 'make sure', 'made sure',
    'has been leading', 'have been leading', 'had been leading',
    'figure out', 'figured out', 'run into', 'ran into', 'take a look',
    'took a look', 'keep an eye on', 'kept an eye on', 'get rid of',
    'got rid of', 'be about to', 'is about to', 'was about to',
    'give it a shot', 'gave it a shot', 'as soon as', 'for the most part',
    'at the end of the day', 'in the middle of', 'on the other hand',
    'a matter of time', 'under pressure', 'in charge of', 'take care of',
    'took care of', 'deal with', 'dealt with', 'end up', 'ended up',
    'work out', 'worked out', 'make sense', 'made sense', 'look like',
    'looked like', 'come up with', 'came up with', 'go ahead', 'hold on',
    'give up', 'gave up', 'turn out', 'turned out', 'get back to',
    'got back to', 'by the time', 'out of the blue', 'on the same page',
    'in the long run', 'a little bit', 'kind of', 'sort of',
  ];

  function normalizeDepth(value) {
    const depth = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return depth === 'strong' || depth === 'weak' || depth === 'medium' ? depth : 'medium';
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeKey(value) {
    return normalizeText(value).toLowerCase();
  }

  function safeText(value, max = MAX_TEXT) {
    if (typeof value !== 'string') return '';
    const text = normalizeText(value);
    if (!text || text.length > max || /[<>]/.test(text) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return '';
    return text;
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function phraseRegex(phrase) {
    const normalized = normalizeText(phrase);
    if (!normalized) return null;
    const tokens = normalized.split(' ');
    const pattern = tokens.map((token) => escapeRegex(token).replace(/\\'/g, "['’]")).join('\\s+');
    try { return new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, 'gi'); }
    catch { return new RegExp(`\\b${pattern}\\b`, 'gi'); }
  }

  function normalizedWithMap(value) {
    const source = String(value == null ? '' : value);
    let text = '';
    const map = [];
    let whitespace = false;
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (/\s/.test(char)) {
        if (!text) continue;
        whitespace = true;
        continue;
      }
      if (whitespace) { text += ' '; map.push(i - 1); whitespace = false; }
      const normalized = /[\u2018\u2019\u201B\u2032]/.test(char) ? "'" : char;
      text += normalized; map.push(i);
    }
    while (text.endsWith(' ')) { text = text.slice(0, -1); map.pop(); }
    return { text, map, source };
  }

  function findOccurrences(text, phrase) {
    const mapped = normalizedWithMap(text);
    const regex = phraseRegex(phrase);
    if (!regex || !mapped.text) return [];
    const result = [];
    let match;
    while ((match = regex.exec(mapped.text))) {
      const start = match.index;
      const end = start + match[0].length;
      const originalStart = mapped.map[start];
      const originalEndIndex = mapped.map[end - 1];
      if (originalStart == null || originalEndIndex == null) continue;
      result.push({
        start,
        end,
        originalStart,
        originalEnd: originalEndIndex + 1,
        text: mapped.source.slice(originalStart, originalEndIndex + 1),
      });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
    return result;
  }

  function entryKey(expression, sense) { return `${normalizeKey(expression)}\u0000${normalizeKey(sense || '')}`; }

  function hash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function nowIso() { return new Date().toISOString(); }

  function makeEntry(id, expression, aliases, meaning, note, kind, sense, contextHints, source = 'builtin') {
    const createdAt = '2026-11-08T00:00:00.000Z';
    const entry = { id, expression, aliases: [...new Set(aliases || [])], meaning, note, kind, sense: sense || '', contextHints: contextHints || [], source, uses: 0, createdAt, updatedAt: createdAt };
    for (const alias of [expression, ...entry.aliases]) safeInflectionPairs.add(`${normalizeKey(expression)}\u0000${normalizeKey(alias)}`);
    return Object.freeze(entry);
  }

  const BUILTIN_ENTRIES = Object.freeze([
    makeEntry('builtin-comes-with', 'comes with', ['come with', 'came with'], '~이 함께 따르다, ~을 동반하다', '조건이나 부담이 함께 붙는다는 뜻으로도 씁니다.', COMMON),
    makeEntry('builtin-tight-clock', 'a tight clock', [], '시간 여유가 거의 없는 상태', 'tight가 시간에 쓰이면 빠듯하다는 뜻입니다.', COMMON),
    makeEntry('builtin-make-sure', 'make sure', ['made sure'], '확실히 하다, 확인하다', '뒤의 내용이 실제로 이루어지도록 확인하는 표현입니다.', COMMON),
    makeEntry('builtin-has-been-leading', 'has been leading', ['have been leading', 'had been leading'], '계속 이끌어 오고 있다', 'has been + -ing는 과거부터 현재까지 이어지는 동작을 나타냅니다.', COMMON),
    makeEntry('builtin-figure-out', 'figure out', ['figured out'], '알아내다, 해결 방법을 찾다', 'figure가 숫자를 계산한다는 뜻에서 문제 해결로 확장됩니다.', COMMON),
    makeEntry('builtin-run-into-person', 'run into', ['ran into'], '우연히 만나다', '사람을 뜻하는 목적어와 만나거나 마주친다는 한국어 단서가 필요합니다.', COMMON, 'person', ['ko:meet']),
    makeEntry('builtin-run-into-problem', 'run into', ['ran into'], '문제에 부딪히다', '문제·곤란을 겪는다는 한국어 단서가 있을 때의 뜻입니다.', COMMON, 'problem', ['ko:problem']),
    makeEntry('builtin-keep-eye', 'keep an eye on', ['kept an eye on'], '주의 깊게 지켜보다', '눈을 계속 두는 이미지에서 감시·관찰의 뜻이 됩니다.', COMMON),
    makeEntry('builtin-get-rid', 'get rid of', ['got rid of'], '없애다, 처분하다', '원치 않는 것을 치워 버린다는 뜻입니다.', COMMON),
    makeEntry('builtin-about-to', 'be about to', ['is about to', 'was about to'], '막 ~하려고 하다', '아주 가까운 미래의 행동을 나타냅니다.', COMMON),
    makeEntry('builtin-end-day', 'at the end of the day', [], '결국, 종합하면', '하루의 끝이라는 시간 표현에서 결론을 꺼내는 말로 확장됩니다.', COMMON),
    makeEntry('builtin-hi', 'hi', ['hey'], '안녕', '짧은 인사말입니다. 강한 학습 깊이에서만 재사용합니다.', COMMON, 'greeting', ['greeting']),
    makeEntry('builtin-hello', 'hello', [], '안녕하세요, 안녕', '상대에게 말을 거는 기본 인사말입니다. 강한 학습 깊이에서만 재사용합니다.', COMMON, 'greeting', ['greeting']),
    makeEntry('builtin-take-care', 'take care of', ['took care of'], '처리하다, 돌보다', '사람을 돌보거나 일을 처리한다는 두 용법이 있습니다.', COMMON),
    makeEntry('builtin-deal-with', 'deal with', ['dealt with'], '다루다, 대처하다', '문제·사람·주제를 처리하거나 상대한다는 뜻입니다.', COMMON),
    makeEntry('builtin-work-out', 'work out', ['worked out'], '잘 풀리다, 해결하다', '문제가 풀리거나 결과가 좋다는 뜻으로 쓰입니다.', COMMON, 'solve', ['ko:solve']),
    makeEntry('builtin-work-out-exercise', 'work out', ['worked out'], '운동하다', '몸을 단련한다는 뜻으로 쓰는 work out입니다.', COMMON, 'exercise', ['ko:exercise']),
    makeEntry('builtin-make-sense', 'make sense', ['made sense'], '말이 되다, 이해가 되다', '정보가 논리적으로 이해된다는 뜻입니다.', COMMON),
    makeEntry('builtin-come-up', 'come up with', ['came up with'], '생각해 내다, 제안하다', '아이디어나 해결책을 만들어 내는 표현입니다.', COMMON),
    makeEntry('builtin-actionable-intel', 'actionable intel', [], '실제로 행동에 옮길 수 있는 정보·첩보', 'intel은 intelligence의 줄임말이며 여기서는 지능이 아니라 정보입니다.', TERM, 'information', ['domain:military', 'ko:info']),
    makeEntry('builtin-intel', 'intel', [], '정보, 첩보', 'Intel 회사나 프로세서가 아니라 작전·수사 정보라는 문맥을 확인합니다.', TERM, 'information', ['domain:military', 'ko:info']),
    makeEntry('builtin-paramilitary', 'paramilitary offshoot', [], '준군사 조직에서 갈라져 나온 분파', 'paramilitary는 군대와 비슷한 조직, offshoot는 갈라져 나온 조직입니다.', TERM, 'organization', ['domain:military']),
    makeEntry('builtin-cpr', 'CPR', [], '심폐소생술', '의학적 응급처치 약어입니다.', TERM, 'medicine', ['domain:medicine', 'ko:cpr']),
    makeEntry('builtin-triage', 'triage', [], '환자 분류, 응급도 분류', '치료 우선순위를 정하는 의료 현장 용어입니다.', TERM, 'medicine', ['domain:medicine']),
    makeEntry('builtin-extraction', 'extraction point', [], '철수 지점, 구출 지점', '작전 인원이 빠져나오거나 회수되는 장소입니다.', TERM, 'military', ['domain:military']),
    makeEntry('builtin-chain-command', 'chain of command', [], '지휘 계통', '명령이 전달되는 조직의 계층 구조입니다.', TERM, 'military', ['domain:military']),
    makeEntry('builtin-safe-house', 'safe house', [], '은신처, 안전 가옥', '신원을 숨기거나 보호하기 위한 장소입니다.', TERM, 'military', ['domain:military']),
    makeEntry('builtin-jurisdiction', 'jurisdiction', [], '관할권', '법원이 사건을 다룰 권한이 미치는 범위입니다.', TERM, 'legal', ['domain:legal']),
    makeEntry('builtin-due-process', 'due process', [], '적법 절차', '법이 정한 공정한 절차를 뜻하는 법률 용어입니다.', TERM, 'legal', ['domain:legal']),
    makeEntry('builtin-blood-pressure', 'blood pressure', [], '혈압', '심혈관 상태를 나타내는 의료 용어입니다.', TERM, 'medicine', ['domain:medicine']),
  ]);

  const builtinById = new Map(BUILTIN_ENTRIES.map((entry) => [entry.id, entry]));
  const BASIC_GREETINGS = new Set(['hi', 'hello', 'hey', 'good morning', 'good evening']);
  const storageLocks = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

  function isTermExpression(expression) {
    const key = normalizeKey(expression);
    return termLexicon.some((term) => key === term || key.includes(term));
  }

  function isCommonExpression(expression) {
    const key = normalizeKey(expression);
    return commonPatterns.some((pattern) => key === pattern) || BUILTIN_ENTRIES.some((entry) => entry.kind === COMMON && (normalizeKey(entry.expression) === key || entry.aliases.some((alias) => normalizeKey(alias) === key)));
  }

  function hasProperNameOnly(expression) {
    const words = normalizeText(expression).split(/\s+/).filter(Boolean);
    return words.length > 0 && words.every((word) => /^[A-Z][a-z]+$/.test(word));
  }

  function looksCommon(expression) {
    const words = normalizeText(expression).split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
    if (words.length < 2 || hasProperNameOnly(expression) || isTermExpression(expression)) return false;
    // Two or more non-proper-name words can be a useful sentence-specific chunk;
    // arbitrary single words are deliberately rejected by this conservative inference.
    return true;
  }

  function contextValue(context) {
    const c = context && typeof context === 'object' ? context : {};
    return {
      english: normalizeText(c.english || c.text || ''),
      korean: normalizeText(c.korean || c.ko || ''),
      previous: normalizeText(c.previous || ''),
      next: normalizeText(c.next || ''),
      domain: normalizeKey(c.domain || ''),
    };
  }

  function hasKoreanSignal(korean, type) {
    const text = korean || '';
    if (type === 'meet') return /만나|만났|마주치|마주쳤/.test(text);
    if (type === 'exercise') return /운동|헬스|체력|근력/.test(text);
    if (type === 'solve') return /해결|풀리|풀렸|계산|성공|잘돼|잘됐|잘 되|잘 됐/.test(text);
    if (type === 'problem') return /문제|곤란|난관|사고|장애|지연|실수|막히/.test(text);
    if (type === 'info') return /정보|첩보|소식|자료|보고/.test(text);
    if (type === 'cpr') return /심폐|소생/.test(text);
    return false;
  }

  function hasDomainSignal(context, domain) {
    const all = `${context.domain} ${context.english} ${context.korean}`.toLowerCase();
    if (domain === 'military') return /military|paramilitary|operation|operational|mission|tactical|squad|command|intel|extraction|safe house|군|작전|부대|지휘|첩보|철수/.test(all);
    if (domain === 'medicine') return /medical|medicine|hospital|patient|doctor|nurse|emergency|cpr|triage|blood pressure|의료|환자|응급|병원|심폐/.test(all);
    if (domain === 'legal') return /legal|court|law|judge|jurisdiction|due process|법|법원|재판|관할|절차/.test(all);
    if (domain === 'science') return /science|scientific|lab|experiment|molecule|physics|chemistry|과학|실험|분자/.test(all);
    if (domain === 'technical') return /computer|software|hardware|cpu|processor|chip|server|code|technical|컴퓨터|프로세서|서버|코드/.test(all);
    return Boolean(context.domain && context.domain.includes(domain));
  }

  function intelBrandConflict(context, occurrenceText) {
    const all = `${context.english} ${context.previous} ${context.next}`;
    if (!/\bIntel\b/.test(occurrenceText || '') && !/\bIntel\b/.test(all)) return false;
    if (/\b(?:CPU|processor|chip|laptop|computer|hardware|Core i\d|graphics|Windows|Mac)\b/i.test(all)) return true;
    return !hasKoreanSignal(context.korean, 'info') && !/\b(?:mission|military|tactical|classified|intelligence|operation)\b/i.test(all) && !/작전|첩보|군사|부대/.test(context.korean);
  }

  function hintMatches(hint, context) {
    const value = normalizeKey(hint);
    if (!value) return false;
    if (value.startsWith('ko:')) {
      const signal = value.slice(3);
      return hasKoreanSignal(context.korean, signal) || new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(context.korean);
    }
    if (value.startsWith('domain:')) return hasDomainSignal(context, value.slice(7));
    return normalizeKey(`${context.english} ${context.korean} ${context.domain}`).includes(value);
  }

  function suitable(entry, context, depth, occurrenceText) {
    if (depth === 'weak' && entry.kind !== TERM) return false;
    if (depth === 'medium' && entry.kind !== COMMON) return false;
    if ((depth === 'medium' || depth === 'weak') && BASIC_GREETINGS.has(normalizeKey(entry.expression))) return false;
    if (entry.kind === TERM && normalizeKey(entry.expression) === 'intel' && intelBrandConflict(context, occurrenceText)) return false;
    if (entry.sense === 'greeting') return true;
    if (!entry.sense && (!entry.contextHints || !entry.contextHints.length)) return true;
    if (entry.sense === 'ambiguous') return false;
    if (entry.sense === 'person' || entry.sense === 'problem') {
      if(hasKoreanSignal(context.korean,'meet') && hasKoreanSignal(context.korean,'problem'))return false;
      if (entry.sense === 'person') return hasKoreanSignal(context.korean, 'meet');
      return hasKoreanSignal(context.korean, 'problem');
    }
    if (entry.contextHints && entry.contextHints.length) return entry.contextHints.some((hint) => hintMatches(hint, context));
    return true;
  }

  function matchesForEntries(entries, context, depth) {
    const all = [];
    for (const entry of entries) {
      const phrases = [entry.expression, ...(entry.aliases || [])].filter(Boolean);
      for (const phrase of phrases) {
        for (const occurrence of findOccurrences(context.english, phrase)) {
          all.push({ entry, occurrence, phrase, suitable: suitable(entry, context, depth, occurrence.text) });
        }
      }
    }
    return all;
  }

  function overlap(a, b) { return a.start < b.end && b.start < a.end; }

  function selectMatches(matches, limit = MAX_REUSED) {
    const byEntry = new Map();
    for (const match of matches) {
      const current = byEntry.get(match.entry.id);
      if (!current || (match.occurrence.end - match.occurrence.start) > (current.occurrence.end - current.occurrence.start)) byEntry.set(match.entry.id, match);
    }
    return [...byEntry.values()]
      .sort((a, b) => (b.occurrence.end - b.occurrence.start) - (a.occurrence.end - a.occurrence.start) || a.occurrence.start - b.occurrence.start)
      .filter((match, index, list) => list.slice(0, index).every((prior) => !overlap(prior.occurrence, match.occurrence)))
      .slice(0, limit);
  }

  function patternMatches(context, patterns) {
    const matches = [];
    for (const phrase of patterns) {
      const occurrences = findOccurrences(context.english, phrase);
      for (const occurrence of occurrences) matches.push({ phrase, occurrence });
    }
    return matches;
  }

  function uniqueCandidates(matches, blockedOccurrences = []) {
    const sorted = [...matches]
      .sort((a, b) => (b.occurrence.end - b.occurrence.start) - (a.occurrence.end - a.occurrence.start) || a.occurrence.start - b.occurrence.start);
    const result = [];
    for (const match of sorted) {
      if (blockedOccurrences.some((blocked) => overlap(blocked, match.occurrence))) continue;
      const key = normalizeKey(match.occurrence.text);
      if (!key || result.some((item) => item.key === key)) continue;
      if (result.some((item) => overlap(item.occurrence, match.occurrence))) continue;
      result.push({ key, occurrence: match.occurrence, text: match.occurrence.text });
      if (result.length >= MAX_REUSED) break;
    }
    return result;
  }

  function termPatternMatches(context, entries) {
    const patterns = [...new Set([...termLexicon, ...entries.filter((entry) => entry.kind === TERM).flatMap((entry) => [entry.expression, ...(entry.aliases || [])])])];
    return patternMatches(context, patterns).filter(match => !(normalizeKey(match.phrase)==='intel' && intelBrandConflict(context,match.occurrence.text)));
  }

  function planGeneration(entries, context, depthValue) {
    const depth = normalizeDepth(depthValue);
    const current = contextValue(context);
    if (!current.english) return { eligible: false, reused: [], candidates: [], reason: 'empty dialogue' };
    const list = Array.isArray(entries) ? entries : [];
    const matches = matchesForEntries(list, current, depth);
    const reusable = selectMatches(matches.filter((match) => match.suitable));
    const reused = reusable.map((match) => ({ ...clone(match.entry), matchedExpression: match.occurrence.text }));
    const blocked = reusable.map((match) => match.occurrence);

    if (depth === 'strong') {
      return {
        eligible: reused.length === 0,
        reused,
        candidates: [],
        reason: reused.length ? 'reused suitable phrase before generation' : 'no suitable reusable phrase; strong depth covers the dialogue',
      };
    }

    const commonKnown = matches.filter((match) => match.entry.kind === COMMON && !match.suitable && !BASIC_GREETINGS.has(normalizeKey(match.entry.expression)))
      .map((match) => ({ phrase: match.phrase, occurrence: match.occurrence }));
    const commonPatterns = patternMatches(current, commonPatternsList());
    const commonCandidates = uniqueCandidates([...commonKnown, ...commonPatterns], blocked);
    let candidateMatches = commonCandidates;
    if (depth === 'weak') {
      candidateMatches = uniqueCandidates(termPatternMatches(current, list).filter((match) => !commonPatternsList().some((phrase) => normalizeKey(phrase) === normalizeKey(match.phrase))), blocked);
      // Weak depth intentionally ignores all common expressions, even if they were reusable.
      return {
        eligible: candidateMatches.length > 0,
        reused: reused.filter((entry) => entry.kind === TERM),
        candidates: candidateMatches.map((match) => match.text),
        reason: candidateMatches.length ? 'specialized terminology cue found' : 'weak depth only accepts specialized terminology',
      };
    }

    const candidates = candidateMatches.map((match) => match.text);
    return {
      eligible: candidates.length > 0,
      reused,
      candidates,
      reason: candidates.length ? 'new useful collocation candidate found' : (reused.length ? 'only reusable phrases found' : 'no conservative candidate found'),
    };
  }

  function commonPatternsList() { return commonPatterns; }

  function deriveSense(expression, context) {
    const key = normalizeKey(expression);
    if (key === 'run into' || key === 'ran into') {
      if (hasKoreanSignal(context.korean, 'meet')) return 'person';
      if (hasKoreanSignal(context.korean, 'problem')) return 'problem';
      return 'ambiguous';
    }
    return '';
  }

  function deriveHints(expression, context, sense) {
    const hints = [];
    if (sense === 'person') hints.push('ko:meet');
    if (sense === 'problem') hints.push('ko:problem');
    if (isTermExpression(expression)) {
      if (/cpr|triage|blood pressure/i.test(expression)) hints.push('domain:medicine');
      else if (/jurisdiction|due process/i.test(expression)) hints.push('domain:legal');
      else if (/intel|paramilitary|extraction|command|safe house|surveillance/i.test(expression)) hints.push('domain:military');
    }
    return hints;
  }

  function actualAliasSafe(expression, alias) {
    const a = normalizeKey(expression);
    const b = normalizeKey(alias);
    if (!a || !b) return false;
    if (safeInflectionPairs.has(`${a}\u0000${b}`) || safeInflectionPairs.has(`${b}\u0000${a}`)) return true;
    return false;
  }

  function inferKind(expression, requested) {
    if (requested === COMMON || requested === TERM) return requested;
    if (BASIC_GREETINGS.has(normalizeKey(expression))) return COMMON;
    if (isTermExpression(expression)) return TERM;
    if (looksCommon(expression)) return COMMON;
    return '';
  }

  function sanitizeHints(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((hint) => safeText(String(hint), 80)).filter(Boolean))].slice(0, 8);
  }

  function sanitizePersistedEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const expression = safeText(raw.expression, 120);
    const kind = raw.kind === TERM ? TERM : raw.kind === COMMON ? COMMON : '';
    if (!expression || !kind || !safeText(raw.meaning, 300)) return null;
    const aliases = Array.isArray(raw.aliases) ? [...new Set(raw.aliases.map((alias) => safeText(alias, 120)).filter(Boolean))].slice(0, 10) : [];
    return {
      id: safeText(raw.id, 120) || `learned-${hash(entryKey(expression, raw.sense || ''))}`,
      expression,
      aliases,
      meaning: safeText(raw.meaning, 300),
      note: safeText(raw.note, 500),
      kind,
      sense: safeText(raw.sense, 80),
      contextHints: sanitizeHints(raw.contextHints),
      source: 'ai',
      uses: Number.isFinite(raw.uses) && raw.uses >= 0 ? Math.floor(raw.uses) : 0,
      createdAt: safeText(raw.createdAt, 40) || nowIso(),
      updatedAt: safeText(raw.updatedAt, 40) || nowIso(),
    };
  }

  async function readStored(area) {
    if (!area || typeof area.get !== 'function') return { entries: [], reuses: 0 };
    let result;
    result = await area.get([STORAGE_KEY, 'studyPhraseReuseStatsV1']);
    const raw = result && result[STORAGE_KEY] ? result[STORAGE_KEY] : result;
    const entries = Array.isArray(raw?.entries) ? raw.entries.map(sanitizePersistedEntry).filter(Boolean).slice(0, MAX_LEARNED) : [];
    const legacyReuses = Number.isFinite(raw?.stats?.reuses) && raw.stats.reuses >= 0 ? Math.floor(raw.stats.reuses) : 0;
    const reuses = Math.max(legacyReuses, Number(result?.studyPhraseReuseStatsV1?.total) || 0);
    return { entries, reuses };
  }

  async function writeStored(area, state) {
    if (!area || typeof area.set !== 'function') return;
    const value = {
      version: SCHEMA_VERSION,
      entries: state.entries.slice(0, MAX_LEARNED).map((entry) => ({ ...entry, source: 'ai' })),
      stats: { reuses: Math.max(0, Math.floor(state.reuses || 0)) },
    };
    await area.set({ [STORAGE_KEY]: value });
  }

  function withStorageLock(area, task) {
    if (!area || (typeof area !== 'object' && typeof area !== 'function')) return Promise.resolve().then(task);
    const prior = storageLocks.get(area) || Promise.resolve();
    const current = prior.catch(() => undefined).then(task);
    storageLocks.set(area, current.catch(() => undefined));
    return current;
  }

  function allEntries(state) { return [...BUILTIN_ENTRIES, ...state.entries]; }

  function matchingEntryKey(entry) { return entryKey(entry.expression, entry.sense || ''); }

  function phraseInput(phrase, context) {
    if (!phrase || typeof phrase !== 'object') return { error: 'invalid phrase' };
    const requestedExpression = safeText(phrase.expression, 120);
    if (!requestedExpression) return { error: 'expression rejected' };
    const english = context.english;
    const expressionOccurrences = findOccurrences(english, requestedExpression);
    const requestedAliases = Array.isArray(phrase.aliases) ? phrase.aliases : [];
    const actualAliases = [];
    for (const aliasValue of requestedAliases) {
      const alias = safeText(String(aliasValue), 120);
      if (!alias || normalizeKey(alias) === normalizeKey(requestedExpression)) continue;
      const occurs = findOccurrences(english, alias).length > 0;
      if (occurs || actualAliasSafe(requestedExpression, alias)) actualAliases.push(alias);
    }
    let expression = requestedExpression;
    if (!expressionOccurrences.length) {
      const actualAlias = actualAliases.find((alias) => findOccurrences(english, alias).length > 0);
      if (!actualAlias) return { error: 'expression not present in English subtitle' };
      if (!actualAliasSafe(requestedExpression, actualAlias)) expression = actualAlias;
    }
    const meaning = safeText(phrase.meaning, 300);
    if (!meaning) return { error: 'meaning rejected' };
    const note = safeText(phrase.annotation || phrase.breakdown || phrase.note || '', 500);
    const kind = inferKind(expression, phrase.kind);
    if (!kind) return { error: 'unknown single-word phrase kind' };
    const sense = safeText(phrase.sense, 80) || deriveSense(expression, context);
    const contextHints = sanitizeHints(phrase.contextHints).length ? sanitizeHints(phrase.contextHints) : deriveHints(expression, context, sense);
    return {
      entry: {
        id: `learned-${hash(entryKey(expression, sense))}`,
        expression,
        aliases: [...new Set(actualAliases.filter((alias) => normalizeKey(alias) !== normalizeKey(expression)))].slice(0, 10),
        meaning,
        note,
        kind,
        sense,
        contextHints,
        source: 'ai',
        uses: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    };
  }

  function publicEntry(entry) { return clone(entry); }

  function createStore(storageLocal) {
    const area = storageLocal || (root && root.chrome && root.chrome.storage && root.chrome.storage.local) || null;

    async function lookup(context, depth) {
      return withStorageLock(area, async () => {
        const state = await readStored(area);
        const plan = planGeneration(allEntries(state), context, depth);
        if (!plan.reused.length) return plan;
        const ids = new Set(plan.reused.map((entry) => entry.id));
        for (const entry of plan.reused) entry.uses = (entry.uses || 0) + 1;
        state.reuses += plan.reused.length;
        // A hit writes a tiny counter, not the entire 2,000-entry dictionary.
        if(area?.set)await area.set({studyPhraseReuseStatsV1:{total:state.reuses}});
        return plan;
      });
    }

    async function remember(explanation, contextInput) {
      return withStorageLock(area, async () => {
        const state = await readStored(area);
        const context = contextValue(contextInput);
        const saved = [];
        const rejected = [];
        const phrases = Array.isArray(explanation?.phrases) ? explanation.phrases : [];
        for (const phrase of phrases) {
          const parsed = phraseInput(phrase, context);
          if (parsed.error) { rejected.push({ expression: safeText(phrase?.expression, 120), reason: parsed.error }); continue; }
          const entry = parsed.entry;
          const key = matchingEntryKey(entry);
          const existingBuiltin = BUILTIN_ENTRIES.find((candidate) => matchingEntryKey(candidate) === key || (candidate.expression === entry.expression && candidate.sense === entry.sense));
          const existing = state.entries.find((candidate) => matchingEntryKey(candidate) === key);
          if (existingBuiltin) { rejected.push({ expression: entry.expression, reason: 'builtin exists' }); continue; }
          if (existing) {
            existing.meaning = entry.meaning;
            existing.note = entry.note;
            existing.aliases = [...new Set([...existing.aliases, ...entry.aliases])].slice(0, 10);
            existing.contextHints = [...new Set([...existing.contextHints, ...entry.contextHints])].slice(0, 8);
            existing.updatedAt = nowIso();
            saved.push(publicEntry(existing));
            continue;
          }
          if (state.entries.length >= MAX_LEARNED) {
            rejected.push({ expression: entry.expression, reason: 'CAP_REACHED' });
            continue;
          }
          state.entries.push(entry);
          saved.push(publicEntry(entry));
        }
        await writeStored(area, state);
        return { ok: true, saved, rejected, full: state.entries.length >= MAX_LEARNED, totalLearned: state.entries.length };
      });
    }

    async function list(options = {}) {
      const state = await readStored(area);
      const query = normalizeKey(options.query || '');
      const offset = Math.max(0, Number.isFinite(options.offset) ? Math.floor(options.offset) : 0);
      const limit = Math.min(200, Math.max(1, Number.isFinite(options.limit) ? Math.floor(options.limit) : 50));
      const entries = allEntries(state).filter((entry) => {
        if (!query) return true;
        return [entry.expression, ...(entry.aliases || []), entry.meaning, entry.note, ...(entry.contextHints || [])].some((value) => normalizeKey(value).includes(query));
      });
      return { entries: entries.slice(offset, offset + limit).map(publicEntry), total: entries.length };
    }

    async function stats() {
      const state = await readStored(area);
      return { total: BUILTIN_ENTRIES.length + state.entries.length, builtin: BUILTIN_ENTRIES.length, learned: state.entries.length, reuses: state.reuses };
    }

    async function remove(id) {
      return withStorageLock(area, async () => {
        if (builtinById.has(id)) return { ok: false, removed: false, reason: 'BUILTIN_NOT_DELETABLE' };
        const state = await readStored(area);
        const before = state.entries.length;
        state.entries = state.entries.filter((entry) => entry.id !== id);
        const removed = state.entries.length !== before;
        if (removed) await writeStored(area, state);
        return { ok: true, removed, reason: removed ? undefined : 'NOT_FOUND' };
      });
    }

    return { lookup, remember, list, stats, remove };
  }

  return {
    STORAGE_KEY,
    SCHEMA_VERSION,
    MAX_LEARNED,
    BUILTIN_ENTRIES: BUILTIN_ENTRIES.map(clone),
    normalizeDepth,
    planGeneration,
    createStore,
  };
});
