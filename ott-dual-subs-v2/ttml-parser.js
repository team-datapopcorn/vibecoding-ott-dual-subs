/**
 * TTML/DFXP 파서 - Netflix TTML 자막을 파싱하여 자막 큐 배열로 변환
 *
 * Netflix TTML 구조:
 *   <tt> → <body> → <div> → <p begin="..." end="...">텍스트</p>
 *
 * 타임코드 형식:
 *   - "HH:MM:SS.mmm" (표준)
 *   - "14612515t" (틱 기반, 10,000,000 ticks/sec)
 *
 * 반환: [{ startTime: 초, endTime: 초, text: "자막 텍스트" }, ...]
 */
function parseTTML(xmlText) {
  const cues = [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');

    // 파싱 에러 체크
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.error('[TTML 파서] XML 파싱 에러:', parseError.textContent);
      return cues;
    }

    // tickRate 확인 (틱 기반 타임코드용)
    const ttEl = doc.querySelector('tt');
    let tickRate = 10000000; // Netflix 기본값: 10M ticks/sec
    if (ttEl) {
      const trAttr =
        ttEl.getAttribute('ttp:tickRate') ||
        ttEl.getAttributeNS('http://www.w3.org/ns/ttml#parameter', 'tickRate');
      if (trAttr) tickRate = parseInt(trAttr);
    }

    // frameRate 확인 (프레임 기반 타임코드용)
    let frameRate = 24;
    if (ttEl) {
      const frAttr =
        ttEl.getAttribute('ttp:frameRate') ||
        ttEl.getAttributeNS('http://www.w3.org/ns/ttml#parameter', 'frameRate');
      if (frAttr) frameRate = parseInt(frAttr);
    }

    // 모든 <p> 요소에서 자막 추출 (네임스페이스 무시)
    const pElements = doc.querySelectorAll('p');

    for (const p of pElements) {
      const beginAttr = p.getAttribute('begin');
      const endAttr = p.getAttribute('end') || p.getAttribute('dur');
      if (!beginAttr) continue;

      const startTime = parseTTMLTimestamp(beginAttr, tickRate, frameRate);
      let endTime;

      if (p.getAttribute('end')) {
        endTime = parseTTMLTimestamp(p.getAttribute('end'), tickRate, frameRate);
      } else if (p.getAttribute('dur')) {
        endTime = startTime + parseTTMLTimestamp(p.getAttribute('dur'), tickRate, frameRate);
      } else {
        endTime = startTime + 3; // 기본 3초
      }

      // 텍스트 추출 (<br> → 줄바꿈, <span> 안의 텍스트 포함)
      const text = extractTTMLText(p);
      if (!text) continue;

      cues.push({ startTime, endTime, text });
    }
  } catch (err) {
    console.error('[TTML 파서] 파싱 실패:', err);
  }

  return cues;
}

/**
 * TTML 타임스탬프를 초 단위로 변환
 */
function parseTTMLTimestamp(ts, tickRate, frameRate) {
  if (!ts) return 0;

  // 틱 기반: "14612515t"
  if (ts.endsWith('t')) {
    return parseInt(ts.slice(0, -1)) / tickRate;
  }

  // 밀리초 기반: "1234ms"
  if (ts.endsWith('ms')) {
    return parseFloat(ts.slice(0, -2)) / 1000;
  }

  // 초 기반: "12.345s"
  if (ts.endsWith('s') && !ts.includes(':')) {
    return parseFloat(ts.slice(0, -1));
  }

  // 분 기반: "2.5m"
  if (ts.endsWith('m') && !ts.includes(':')) {
    return parseFloat(ts.slice(0, -1)) * 60;
  }

  // 시간 기반: "1.5h"
  if (ts.endsWith('h')) {
    return parseFloat(ts.slice(0, -1)) * 3600;
  }

  // 표준 형식: "HH:MM:SS.mmm" 또는 "HH:MM:SS:FF" (프레임)
  const parts = ts.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    // 마지막 부분이 프레임인지 밀리초인지 확인
    const lastPart = parts[2];
    if (lastPart.includes('.')) {
      const secs = parseFloat(lastPart);
      return hours * 3600 + minutes * 60 + secs;
    } else {
      // HH:MM:SS 형식 (프레임 없음)
      return hours * 3600 + minutes * 60 + parseInt(lastPart);
    }
  }

  if (parts.length === 4) {
    // HH:MM:SS:FF (프레임)
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parseInt(parts[2]);
    const frames = parseInt(parts[3]);
    return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
  }

  return parseFloat(ts) || 0;
}

/**
 * TTML <p> 요소에서 텍스트 추출 (<br> → 줄바꿈)
 */
function extractTTMLText(element) {
  let text = '';

  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.localName.toLowerCase();
      if (tag === 'br') {
        text += '\n';
      } else if (tag === 'span' || tag === 'i' || tag === 'b' || tag === 'u') {
        text += extractTTMLText(node);
      }
    }
  }

  return text.trim();
}

/**
 * TTML인지 간단 판별 (첫 몇 글자로)
 */
function isTTML(text) {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<tt') ||
    trimmed.includes('xmlns="http://www.w3.org/ns/ttml"')
  );
}
