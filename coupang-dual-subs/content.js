// ============================================================
// content.js - ISOLATED world에서 실행
// 자막 표시, DOM 감시, chrome.storage 연동
// ============================================================
(() => {
  'use strict';

  const LOG = '[DualSub]';
  let isEnabled = true;
  let dualContainer = null;
  let lastDisplayedText = '';
  let domObserver = null;
  let timeSyncActive = false;
  let translateRequestId = 0;
  const pendingTranslations = new Map();
  const translationCache = new Map();

  // 파싱된 자막 큐
  let parsedCues = [];

  // ============================================================
  // 1. inject.js를 MAIN world에 삽입
  // ============================================================
  function injectMainWorldScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    console.log(LOG, 'Injected main-world script');
  }

  // ============================================================
  // 2. postMessage 수신: 자막 데이터 & 번역 응답
  // ============================================================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'DUAL_SUB_SUBTITLE_DATA') {
      const { text, url } = event.data.payload;
      processSubtitleData(text, url);
    }

    if (event.data?.type === 'DUAL_SUB_TRANSLATE_RESPONSE') {
      const { translated, requestId } = event.data.payload;
      const resolve = pendingTranslations.get(requestId);
      if (resolve) {
        resolve(translated);
        pendingTranslations.delete(requestId);
      }
    }
  });

  // ============================================================
  // 3. 자막 파일 파싱 (VTT, SRT, TTML)
  // ============================================================
  function processSubtitleData(text, url) {
    if (!text || text.length < 10) return;

    let cues = [];
    if (text.includes('WEBVTT') || url?.toLowerCase().includes('.vtt')) {
      cues = parseVTT(text);
    } else if (text.includes('-->')) {
      cues = parseSRT(text);
    } else if (text.includes('<tt') || text.includes('xmlns')) {
      cues = parseTTML(text);
    }

    if (cues.length > 0) {
      console.log(LOG, `Parsed ${cues.length} cues from`, url);
      parsedCues = cues;
      startTimeSyncLoop();
    }
  }

  function parseVTT(text) {
    const cues = [];
    const blocks = text.split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      for (let i = 0; i < lines.length; i++) {
        // HH:MM:SS.mmm --> HH:MM:SS.mmm
        let match = lines[i].match(
          /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/
        );
        if (match) {
          const start = +match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4] / 1000;
          const end = +match[5] * 3600 + +match[6] * 60 + +match[7] + +match[8] / 1000;
          const content = lines.slice(i + 1).join('\n').replace(/<[^>]*>/g, '').trim();
          if (content) cues.push({ start, end, text: content });
          break;
        }
        // MM:SS.mmm --> MM:SS.mmm
        match = lines[i].match(
          /(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2})[.,](\d{3})/
        );
        if (match) {
          const start = +match[1] * 60 + +match[2] + +match[3] / 1000;
          const end = +match[4] * 60 + +match[5] + +match[6] / 1000;
          const content = lines.slice(i + 1).join('\n').replace(/<[^>]*>/g, '').trim();
          if (content) cues.push({ start, end, text: content });
          break;
        }
      }
    }
    return cues;
  }

  function parseSRT(text) {
    return parseVTT(text);
  }

  function parseTTML(text) {
    const cues = [];
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const pEls = doc.querySelectorAll('p[begin][end], p[begin][dur]');
      for (const p of pEls) {
        const start = parseTTMLTime(p.getAttribute('begin'));
        const end = p.getAttribute('end')
          ? parseTTMLTime(p.getAttribute('end'))
          : start + parseTTMLTime(p.getAttribute('dur') || '0');
        const content = p.textContent.trim();
        if (content && !isNaN(start) && !isNaN(end)) {
          cues.push({ start, end, text: content });
        }
      }
    } catch (e) {
      console.warn(LOG, 'TTML parse error:', e);
    }
    return cues;
  }

  function parseTTMLTime(str) {
    if (!str) return 0;
    const m = str.match(/(\d+):(\d+):(\d+)[.:](\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const s = str.match(/([\d.]+)s/);
    if (s) return parseFloat(s[1]);
    return parseFloat(str) || 0;
  }

  // ============================================================
  // 4. video.timeupdate 기반 동기화
  // ============================================================
  function startTimeSyncLoop() {
    if (timeSyncActive) return;

    const video = document.querySelector('video');
    if (!video) {
      setTimeout(startTimeSyncLoop, 1000);
      return;
    }

    timeSyncActive = true;
    console.log(LOG, 'Time-sync started');

    video.addEventListener('timeupdate', () => {
      if (!isEnabled || parsedCues.length === 0) return;
      const cue = findActiveCue(parsedCues, video.currentTime);
      if (cue) {
        showDualSubtitle(cue.text);
      } else {
        clearDualSubtitles();
      }
    });
  }

  function findActiveCue(cues, time) {
    let lo = 0, hi = cues.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].end < time) lo = mid + 1;
      else if (cues[mid].start > time) hi = mid - 1;
      else return cues[mid];
    }
    return null;
  }

  // ============================================================
  // 5. DOM MutationObserver 폴백
  // ============================================================
  let domRetries = 0;

  function startDOMObserver() {
    if (domObserver) domObserver.disconnect();

    const video = document.querySelector('video');
    if (!video) {
      if (domRetries++ < 60) setTimeout(startDOMObserver, 500);
      return;
    }

    const playerContainer = findPlayerContainer(video);
    if (!playerContainer) {
      if (domRetries++ < 60) setTimeout(startDOMObserver, 500);
      return;
    }

    ensureDualContainer(playerContainer);

    domObserver = new MutationObserver(() => {
      // 네트워크 인터셉트가 성공한 경우 DOM 폴백 스킵
      if (parsedCues.length > 0 && timeSyncActive) return;

      const text = extractSubtitleFromDOM();
      if (text) showDualSubtitle(text);
      else clearDualSubtitles();
    });

    domObserver.observe(playerContainer, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    // TextTrack API 감시
    monitorTextTracks(video);

    console.log(LOG, 'DOM observer started on', playerContainer.tagName, playerContainer.className);
  }

  function findPlayerContainer(video) {
    let el = video.parentElement;
    while (el && el !== document.body) {
      const cls = (el.className || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      if (cls.includes('player') || cls.includes('video') || id.includes('player') || id.includes('video')) {
        return el;
      }
      el = el.parentElement;
    }
    return video.parentElement?.parentElement?.parentElement || video.parentElement;
  }

  function extractSubtitleFromDOM() {
    const selectors = [
      // Shaka Player (쿠팡플레이 등 한국 스트리밍에서 자주 사용)
      '.shaka-text-container span',
      '.shaka-text-container div',
      '.shaka-text-container',
      // 일반 자막 셀렉터
      '.subtitle-text',
      '.player-subtitle',
      '[class*="subtitle"] span',
      '[class*="subtitle"]:not(.dual-sub-container)',
      '[class*="caption"] span',
      '[class*="caption"]:not(.dual-sub-container)',
      '.text-track-display span',
      '.vjs-text-track-display div div div',
      '[class*="text-track"] span',
      '[class*="cue-display"]',
      // 비디오 위 절대 위치 텍스트
      'div[style*="position: absolute"][style*="bottom"] span',
    ];

    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        if (el.closest('.dual-sub-container')) continue;
        const text = el.textContent.trim();
        if (!text || text.length > 500) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        return text;
      }
    }
    return null;
  }

  function monitorTextTracks(video) {
    const attach = () => {
      for (const track of video.textTracks) {
        if (track.mode === 'disabled') continue;
        track.removeEventListener('cuechange', onCueChange);
        track.addEventListener('cuechange', onCueChange);
      }
    };
    video.textTracks.addEventListener('addtrack', attach);
    video.textTracks.addEventListener('change', attach);
    attach();
  }

  function onCueChange(e) {
    if (parsedCues.length > 0 && timeSyncActive) return;
    const cues = e.target.activeCues;
    if (cues?.length > 0) {
      const text = Array.from(cues).map(c => (c.text || '').replace(/<[^>]*>/g, '')).join('\n').trim();
      if (text) showDualSubtitle(text);
    } else {
      clearDualSubtitles();
    }
  }

  // ============================================================
  // 6. 이중자막 UI
  // ============================================================
  function ensureDualContainer(parent) {
    if (dualContainer && document.contains(dualContainer)) return;

    dualContainer = document.createElement('div');
    dualContainer.className = 'dual-sub-container';
    dualContainer.innerHTML = '<div class="dual-sub-primary"></div><div class="dual-sub-secondary"></div>';

    const target = parent || document.body;
    if (getComputedStyle(target).position === 'static') {
      target.style.position = 'relative';
    }
    target.appendChild(dualContainer);
    console.log(LOG, 'Dual subtitle container created');
  }

  async function showDualSubtitle(originalText) {
    if (!originalText || !isEnabled || originalText === lastDisplayedText) return;
    lastDisplayedText = originalText;

    if (!dualContainer || !document.contains(dualContainer)) {
      const video = document.querySelector('video');
      if (video) ensureDualContainer(findPlayerContainer(video));
      if (!dualContainer) return;
    }

    const primaryEl = dualContainer.querySelector('.dual-sub-primary');
    const secondaryEl = dualContainer.querySelector('.dual-sub-secondary');

    primaryEl.textContent = originalText;
    dualContainer.classList.remove('dual-sub-hidden');

    const isKorean = /[\uAC00-\uD7AF]/.test(originalText);
    const from = isKorean ? 'ko' : 'en';
    const to = isKorean ? 'en' : 'ko';

    const translated = await translateWithCache(originalText, from, to);
    if (lastDisplayedText === originalText && translated) {
      secondaryEl.textContent = translated;
    }
  }

  function clearDualSubtitles() {
    if (!dualContainer) return;
    const p = dualContainer.querySelector('.dual-sub-primary');
    const s = dualContainer.querySelector('.dual-sub-secondary');
    if (p) p.textContent = '';
    if (s) s.textContent = '';
    lastDisplayedText = '';
  }

  // ============================================================
  // 7. 번역 (inject.js 경유, 캐시 포함)
  // ============================================================
  function translateWithCache(text, from, to) {
    const key = `${from}:${to}:${text}`;
    if (translationCache.has(key)) return Promise.resolve(translationCache.get(key));

    return new Promise((resolve) => {
      const id = ++translateRequestId;
      pendingTranslations.set(id, (translated) => {
        translationCache.set(key, translated);
        if (translationCache.size > 500) {
          translationCache.delete(translationCache.keys().next().value);
        }
        resolve(translated);
      });

      window.postMessage({
        type: 'DUAL_SUB_TRANSLATE_REQUEST',
        payload: { text, from, to, requestId: id },
      }, '*');

      // 타임아웃 3초
      setTimeout(() => {
        if (pendingTranslations.has(id)) {
          pendingTranslations.delete(id);
          resolve('');
        }
      }, 3000);
    });
  }

  // ============================================================
  // 8. chrome.storage 연동
  // ============================================================
  chrome.storage?.onChanged?.addListener((changes) => {
    if (changes.dualSubEnabled) {
      isEnabled = changes.dualSubEnabled.newValue;
      if (!isEnabled) {
        clearDualSubtitles();
        if (dualContainer) dualContainer.classList.add('dual-sub-hidden');
      } else {
        if (dualContainer) dualContainer.classList.remove('dual-sub-hidden');
      }
    }
  });

  chrome.storage?.local?.get(['dualSubEnabled'], (result) => {
    isEnabled = result.dualSubEnabled !== false;
  });

  // ============================================================
  // 9. 초기화 & SPA 대응
  // ============================================================
  function init() {
    if (!window.location.hostname.includes('coupangplay.com')) return;
    console.log(LOG, 'Coupang Play detected. Initializing v2.0...');

    // MAIN world 스크립트 삽입 (fetch/XHR 인터셉트)
    injectMainWorldScript();

    // DOM 옵저버 시작
    setTimeout(startDOMObserver, 1500);

    // 주기적 상태 체크 (SPA 네비게이션, 새 영상 등)
    setInterval(() => {
      const video = document.querySelector('video');
      if (video && (!dualContainer || !document.contains(dualContainer))) {
        console.log(LOG, 'New video detected, reinitializing...');
        domRetries = 0;
        startDOMObserver();
      }
      if (video && parsedCues.length > 0 && !timeSyncActive) {
        startTimeSyncLoop();
      }
    }, 3000);

    // SPA 라우트 변경 감지
    const origPush = history.pushState;
    history.pushState = function (...args) {
      origPush.apply(this, args);
      setTimeout(resetAndRestart, 1500);
    };
    window.addEventListener('popstate', () => setTimeout(resetAndRestart, 1500));
  }

  function resetAndRestart() {
    console.log(LOG, 'Route change, resetting...');
    if (domObserver) domObserver.disconnect();
    domObserver = null;
    domRetries = 0;
    timeSyncActive = false;
    parsedCues = [];
    lastDisplayedText = '';
    if (dualContainer && document.contains(dualContainer)) dualContainer.remove();
    dualContainer = null;
    setTimeout(startDOMObserver, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
