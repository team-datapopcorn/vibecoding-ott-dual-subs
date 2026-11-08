/**
 * Content Script - OTT 이중자막
 *
 * 쿠팡플레이 / 넷플릭스에서 한국어+영어 자막을 동시 오버레이합니다.
 * - 쿠팡플레이: 자막 설정 패널에 "한국어+영어" 옵션 주입
 * - 넷플릭스: 자막 설정 패널에 "한국어+영어" 옵션 주입
 * - 공통: 영상 위에 이중자막 오버레이 렌더링
 */

(function () {
  'use strict';

  // === 플랫폼 감지 ===
  const hostname = location.hostname;
  const PLATFORM = hostname.includes('netflix')
    ? 'netflix'
    : hostname.includes('coupangplay')
      ? 'coupangplay'
      : 'unknown';

  if (PLATFORM === 'unknown') return;

  const subtitleSessionApi = globalThis.OTTDualSubsSession || {};
  const resolveSubtitleSourceUpdate =
    subtitleSessionApi.resolveSubtitleSourceUpdate ||
    ((currentSignature, urls, formats) => {
      const safeUrls = Array.isArray(urls) ? urls : [];
      const safeFormats = Array.isArray(formats) ? formats : [];
      const recentUrls = safeUrls.slice(-2);
      const recentFormats = safeFormats.slice(-2);
      const sources = recentUrls.map((url, index) => ({
        url,
        format: recentFormats[index] || 'vtt',
      }));
      const signature = sources.map((source) => `${source.url}::${source.format}`).join('|');
      return { sources, signature, changed: signature !== currentSignature };
    });

  // === 상태 ===
  let isEnabled = false;
  let koCues = [];
  let enCues = [];
  let overlayEl = null;
  let annotationController = null;
  let koTextEl = null;
  let enTextEl = null;
  let videoEl = document.querySelector('video');
  let animFrameId = null;
  let subtitleUrls = [];
  let subtitleFormats = [];
  let subtitleSignature = '';
  let loadRequestId = 0;
  let lastKnownHref = location.href;

  // === 설정 (기본값) ===
  // 2026-10: 기본 글씨를 키움(영어 18→26, 한국어 20→30). 사용자가 바꾼 값은 저장해 다음 편에도 쓴다.
  let settings = {
    enFontSize: 26,
    koFontSize: 30,
    enColor: '#FFD54F',
    position: 'bottom',
    inlineNotes: true,
    annotationDepth: 'medium',
  };

  // 저장된 설정과 "이중자막 켜 둠" 상태를 불러온다. 켜 둔 상태면 다음 편·새로고침에도 자동으로 켠다.
  let autoEnable = false;
  try {
    chrome.storage.local.get(['dualSettings', 'dualEnabled'], (saved) => {
      saved = saved || {};
      if (saved.dualSettings) { settings = { ...settings, ...saved.dualSettings }; applySettings(); }
      autoEnable = saved.dualEnabled === true;
      if (autoEnable) tryAutoEnable('stored');
    });
  } catch {}

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if(area==='local' && changes.dualSettings?.newValue){settings={...settings,...changes.dualSettings.newValue};applySettings();}
    });
  } catch {}
  function saveEnabled(value) {
    autoEnable = value;
    try { chrome.storage.local.set({ dualEnabled: value }); } catch {}
  }

  let autoEnabling = false;
  async function tryAutoEnable(reason) {
    if (!autoEnable || isEnabled || autoEnabling) return;
    autoEnabling = true;
    try {
      if (await ensureSubtitleSources()) {
        console.log(`[이중자막][${PLATFORM}] 자동 켜기 (${reason})`);
        await enableDualSubs();
        const dualOpt = document.getElementById('dual-sub-option');
        if (dualOpt) applyActiveStyle(dualOpt);
      }
    } finally { autoEnabling = false; }
  }

  // ------------------------------------------------------------------
  // 1) 메시지 수신 (Background / Popup → Content)
  // ------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SUBTITLE_URLS') {
      const changed = applySubtitleSourceUpdate(message.urls, message.formats, 'message');
      console.log(`[이중자막][${PLATFORM}] 자막 URL 수신: ${subtitleUrls.length}개`);

      if (changed && isEnabled) {
        reloadActiveSubtitles('subtitle-update').catch(() => {});
      } else if (!isEnabled) {
        tryAutoEnable('subtitle-detected');
      }

      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'TOGGLE_DUAL_SUBS') {
      saveEnabled(Boolean(message.enabled));
      message.enabled ? enableDualSubs() : disableDualSubs();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'UPDATE_SETTINGS') {
      settings = { ...settings, ...message.settings };
      applySettings();
      try { chrome.storage.local.set({ dualSettings: settings }); } catch {}
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'GET_DUAL_SUB_STATUS') {
      sendResponse({
        enabled: isEnabled,
        hasSubtitles: subtitleUrls.length >= 2,
        platform: PLATFORM,
      });
      return true;
    }

    return true;
  });

  // ------------------------------------------------------------------
  // 2) 자막 설정 패널 감시 → "한국어+영어" 옵션 주입
  // ------------------------------------------------------------------
  const panelObserver = new MutationObserver(() => {
    injectDualOption();
  });
  panelObserver.observe(document.body, { childList: true, subtree: true });

  function injectDualOption() {
    if (document.getElementById('dual-sub-option')) return;

    if (PLATFORM === 'coupangplay') {
      injectCoupangOption();
    } else if (PLATFORM === 'netflix') {
      injectNetflixOption();
    }
  }

  function injectCoupangOption() {
    const items = findCoupangSubtitleItems();
    if (items.length === 0) return;
    injectAfterLastItem(items);
  }

  function findCoupangSubtitleItems() {
    const items = [];
    // 2026-10: 쿠팡플레이가 '자막' 제목을 <h4>로 바꿔서 제목 태그도 함께 찾는다.
    const allElements = document.querySelectorAll('div, span, li, button, p, h1, h2, h3, h4, h5, h6');
    let sectionFound = false;

    for (const el of allElements) {
      const text = el.textContent?.trim();
      if (text === '자막' && el.offsetParent !== null) {
        sectionFound = true;
        continue;
      }
      if (sectionFound) {
        if (
          (text === '자막없음' || text === '한국어' || text === '영어' || text === 'English' || text === 'Korean') &&
          el.offsetParent !== null &&
          el.children.length <= 2
        ) {
          items.push(el);
        }
        if (text === '자막 스타일' || text === '음성') break;
      }
    }
    return items;
  }

  function injectNetflixOption() {
    const items = findNetflixSubtitleItems();
    if (items.length === 0) return;
    injectAfterLastItem(items);
  }

  function findNetflixSubtitleItems() {
    const items = [];
    const allElements = document.querySelectorAll('li, div[role="option"], div[class*="track"]');

    for (const el of allElements) {
      const text = el.textContent?.trim();
      if (!text || text.length > 30) continue;
      if (el.offsetParent === null) continue;

      if (
        text === '한국어' || text === 'Korean' ||
        text === '영어' || text === 'English' ||
        text === '끄기' || text === 'Off'
      ) {
        items.push(el);
      }
    }

    return items;
  }

  function injectAfterLastItem(items) {
    if (items.length === 0) return;

    const lastItem = items[items.length - 1];
    const container = lastItem.parentElement;

    const dualOption = lastItem.cloneNode(true);
    dualOption.id = 'dual-sub-option';

    setInnerText(dualOption, '한국어+영어');
    removeCheckmark(dualOption);

    if (isEnabled) applyActiveStyle(dualOption);

    dualOption.style.cursor = 'pointer';
    dualOption.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDualOptionClick(container);
    });

    if (lastItem.nextSibling) {
      container.insertBefore(dualOption, lastItem.nextSibling);
    } else {
      container.appendChild(dualOption);
    }

    syncMenuChecks();
    console.log(`[이중자막][${PLATFORM}] "한국어+영어" 옵션 주입 완료`);
  }

  function handleDualOptionClick(container) {
    if (!isEnabled) {
      saveEnabled(true);
      enableDualSubs();

      if (container) {
        container.querySelectorAll('svg, [class*="check"], img[src*="check"]').forEach((el) => {
          if (!el.closest('#dual-sub-option')) {
            el.style.visibility = 'hidden';
          }
        });
      }

      const dualOpt = document.getElementById('dual-sub-option');
      if (dualOpt) applyActiveStyle(dualOpt);
    } else {
      saveEnabled(false);
      disableDualSubs();
    }
  }

  // ------------------------------------------------------------------
  // 3) 이중자막 활성화 / 비활성화
  // ------------------------------------------------------------------
  async function enableDualSubs() {
    isEnabled = true;

    if (!(await ensureSubtitleSources())) {
      isEnabled = false;
      console.warn(`[이중자막][${PLATFORM}] 자막 2개 미만, 이중자막 불가`);
      return;
    }

    console.log(`[이중자막][${PLATFORM}] 활성화`);
    await loadCurrentSubtitleSet('manual-enable');
  }

  async function ensureSubtitleSources() {
    if (subtitleUrls.length >= 2) {
      return true;
    }

    console.log(`[이중자막][${PLATFORM}] 자막 URL 부족 — Background에 요청`);
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_MY_SUBTITLES' }, (response) => resolve(response || {}));
      });

      if (res.subtitles && res.subtitles.length >= 2) {
        applySubtitleSourceUpdate(
          res.subtitles.map((subtitle) => subtitle.url),
          res.subtitles.map((subtitle) => subtitle.format),
          'background-sync'
        );
      }
    } catch {}

    return subtitleUrls.length >= 2;
  }

  async function reloadActiveSubtitles(reason) {
    if (!isEnabled) return;

    console.log(`[이중자막][${PLATFORM}] 자막 세트 변경 감지 — 재로딩 (${reason})`);
    resetLoadedCues();
    await loadCurrentSubtitleSet(reason);
  }

  async function loadCurrentSubtitleSet(reason) {
    if (subtitleUrls.length < 2) return;

    const requestId = ++loadRequestId;

    try {
      const responses = await Promise.all(subtitleUrls.map((url) => fetch(url)));
      const texts = await Promise.all(responses.map((response) => response.text()));

      if (requestId !== loadRequestId || !isEnabled) return;

      const allCues = texts.map((text, index) => {
        const format = subtitleFormats[index] || detectFormat(text);
        if (format === 'ttml') return parseTTML(text);
        return parseVTT(text);
      });

      assignLanguages(allCues);

      if (requestId !== loadRequestId || !isEnabled) return;

      console.log(`[이중자막] 로드 완료 (${reason}): 한국어 ${koCues.length}개, 영어 ${enCues.length}개`);

      createOverlay();
      if (overlayEl) overlayEl.style.display = 'flex';
      setNativeSubsHidden(true);
      syncMenuChecks();
      startRendering();
    } catch (err) {
      console.error(`[이중자막][${PLATFORM}] 자막 로딩 실패:`, err);
      if (requestId === loadRequestId) {
        isEnabled = false;
      }
    }
  }

  function disableDualSubs() {
    annotationController?.destroy(); annotationController = null;
    isEnabled = false;
    loadRequestId += 1;
    resetLoadedCues();

    if (overlayEl) overlayEl.style.display = 'none';
    setNativeSubsHidden(false);
    syncMenuChecks();
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }

    const dualOpt = document.getElementById('dual-sub-option');
    if (dualOpt) dualOpt.style.color = '';
    console.log(`[이중자막][${PLATFORM}] 비활성화`);
  }

  // 이중자막을 켜면 사이트 기본 자막을 숨겨 같은 줄이 겹쳐 보이지 않게 한다.
  function setNativeSubsHidden(hidden) {
    const id = 'dual-sub-hide-native';
    const existing = document.getElementById(id);
    if (!hidden) { if (existing) existing.remove(); return; }
    if (existing) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = PLATFORM === 'netflix'
      ? '.player-timedtext{visibility:hidden !important}'
      : '.vjs-text-track-display{visibility:hidden !important}';
    (document.head || document.documentElement).appendChild(style);
  }

  function applySubtitleSourceUpdate(urls, formats, reason) {
    const update = resolveSubtitleSourceUpdate(subtitleSignature, urls || [], formats || []);

    subtitleUrls = update.sources.map((source) => source.url);
    subtitleFormats = update.sources.map((source) => source.format || 'vtt');
    subtitleSignature = update.signature;

    if (update.changed) {
      console.log(`[이중자막][${PLATFORM}] 자막 세트 갱신 (${reason}): ${subtitleUrls.length}개`);
    }

    return update.changed;
  }

  function resetLoadedCues() {
    koCues = [];
    enCues = [];
    clearOverlayText();
  }

  function clearOverlayText() {
    annotationController?.clear();
    if (koTextEl) koTextEl.textContent = '';
    if (enTextEl) enTextEl.textContent = '';
  }

  function resetPlaybackState(reason, resetBackground) {
    annotationController?.clear();
    loadRequestId += 1;
    subtitleUrls = [];
    subtitleFormats = [];
    subtitleSignature = '';
    resetLoadedCues();

    if (overlayEl) {
      overlayEl.style.display = isEnabled ? 'flex' : 'none';
    }

    if (resetBackground) {
      chrome.runtime.sendMessage({ type: 'RESET_SUBTITLE_SESSION', reason }, () => {
        void chrome.runtime.lastError;
      });
    }
  }

  function trackRouteChanges() {
    const onRouteMaybeChanged = () => {
      if (location.href === lastKnownHref) return;

      lastKnownHref = location.href;
      resetPlaybackState('route-change', true);
    };

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(onRouteMaybeChanged, 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(onRouteMaybeChanged, 0);
      return result;
    };

    window.addEventListener('popstate', onRouteMaybeChanged);
  }

  // ------------------------------------------------------------------
  // 4) 자막 포맷 감지 및 언어 판별
  // ------------------------------------------------------------------
  function detectFormat(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('WEBVTT') || trimmed.startsWith('NOTE')) return 'vtt';
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<tt')) return 'ttml';
    if (trimmed.includes('-->')) return 'vtt';
    if (trimmed.includes('xmlns')) return 'ttml';
    return 'vtt';
  }

  function assignLanguages(allCues) {
    koCues = [];
    enCues = [];

    if (allCues.length >= 2) {
      if (isKorean(allCues[0])) {
        koCues = allCues[0];
        enCues = allCues[1];
      } else {
        koCues = allCues[1];
        enCues = allCues[0];
      }
    }
  }

  function isKorean(cues) {
    const sample = cues.slice(0, 10).map((cue) => cue.text).join('');
    const korChars = sample.match(/[\uAC00-\uD7AF]/g);
    return Boolean(korChars && korChars.length > 3);
  }

  // ------------------------------------------------------------------
  // 5) 오버레이 UI
  // ------------------------------------------------------------------
  function createOverlay() {
    annotationController?.destroy(); annotationController = null;
    const existing = document.getElementById('dual-sub-overlay');
    if (existing) existing.remove();

    videoEl = document.querySelector('video');
    if (!videoEl) {
      setTimeout(createOverlay, 1000);
      return;
    }

    let videoContainer;
    if (PLATFORM === 'netflix') {
      videoContainer =
        videoEl.closest('.watch-video--player-view') ||
        videoEl.closest('[data-uia="video-canvas"]') ||
        videoEl.closest('[class*="player"]') ||
        videoEl.parentElement;
    } else {
      videoContainer =
        videoEl.closest('[class*="player"]') ||
        videoEl.parentElement;
    }

    overlayEl = document.createElement('div');
    overlayEl.id = 'dual-sub-overlay';
    overlayEl.style.cssText = `
      position: absolute;
      ${settings.position === 'top' ? 'top: 60px;' : 'bottom: 80px;'}
      left: 0; right: 0;
      display: flex; flex-direction: column;
      align-items: center; gap: 6px;
      pointer-events: none;
      z-index: 999999;
    `;

    enTextEl = document.createElement('div');
    enTextEl.id = 'dual-sub-en';
    enTextEl.style.cssText = `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: ${settings.enFontSize}px;
      font-weight: 500;
      color: ${settings.enColor};
      text-align: center;
      text-shadow: 0 0 4px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.8),
                   1px 1px 3px rgba(0,0,0,0.9), -1px -1px 3px rgba(0,0,0,0.9);
      padding: 2px 16px;
      max-width: 85%;
      line-height: 1.4;
      white-space: pre-wrap;
    `;

    koTextEl = document.createElement('div');
    koTextEl.id = 'dual-sub-ko';
    koTextEl.style.cssText = `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: ${settings.koFontSize}px;
      font-weight: 600;
      color: #FFFFFF;
      text-align: center;
      text-shadow: 0 0 4px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.8),
                   1px 1px 3px rgba(0,0,0,0.9), -1px -1px 3px rgba(0,0,0,0.9);
      padding: 2px 16px;
      max-width: 85%;
      line-height: 1.4;
      white-space: pre-wrap;
    `;

    overlayEl.appendChild(enTextEl);
    overlayEl.appendChild(koTextEl);

    const containerPos = getComputedStyle(videoContainer).position;
    if (containerPos === 'static') videoContainer.style.position = 'relative';

    videoContainer.appendChild(overlayEl);
    if (globalThis.OTTDualSubsAnnotations) {
      annotationController = globalThis.OTTDualSubsAnnotations.mount({
        container: videoContainer, englishEl: enTextEl, koreanEl: koTextEl,
        getVideo: () => videoEl, getSettings: () => settings,
        request: (message) => new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(message, (response) => {
              const failed = chrome.runtime.lastError;
              resolve(failed ? { ok: false } : response);
            });
          } catch { resolve({ ok: false }); }
        }),
      });
    }
    console.log(`[이중자막][${PLATFORM}] 오버레이 생성`);
  }

  function applySettings() {
    if (annotationController && videoEl) annotationController.update(globalThis.OTTDualSubsStudy?.buildContext(enCues, koCues, videoEl.currentTime));
    if (enTextEl) {
      enTextEl.style.fontSize = settings.enFontSize + 'px';
      enTextEl.style.color = settings.enColor;
    }
    if (koTextEl) {
      koTextEl.style.fontSize = settings.koFontSize + 'px';
    }
    if (overlayEl && settings.position) {
      if (settings.position === 'top') {
        overlayEl.style.bottom = 'auto';
        overlayEl.style.top = '60px';
      } else {
        overlayEl.style.top = 'auto';
        overlayEl.style.bottom = '80px';
      }
    }
  }

  // ------------------------------------------------------------------
  // 6) 렌더링 루프
  // ------------------------------------------------------------------
  function startRendering() {
    if (animFrameId) cancelAnimationFrame(animFrameId);

    let lastKo = '';
    let lastEn = '';
    let lastAnnotationCue = '';

    function render() {
      if (!videoEl || !overlayEl || !isEnabled) {
        animFrameId = requestAnimationFrame(render);
        return;
      }

      const time = videoEl.currentTime;
      const koCue = findActiveCue(koCues, time);
      const enCue = findActiveCue(enCues, time);

      const koText = koCue ? koCue.text : '';
      const enText = enCue ? enCue.text : '';

      if (koText !== lastKo) {
        koTextEl.textContent = koText;
        lastKo = koText;
      }
      if (enText !== lastEn) {
        enTextEl.textContent = enText;
        lastEn = enText;
      }

      const annotationCue = enCue ? enCue.startTime + ':' + enCue.endTime : '';
      if (annotationCue !== lastAnnotationCue) {
        lastAnnotationCue = annotationCue;
        annotationController?.update(globalThis.OTTDualSubsStudy?.buildContext(enCues, koCues, time));
      }
      animFrameId = requestAnimationFrame(render);
    }

    render();
  }

  // ------------------------------------------------------------------
  // 7) 유틸리티
  // ------------------------------------------------------------------
  function setInnerText(el, text) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    let found = false;

    while ((node = walker.nextNode())) {
      if (node.textContent.trim().length > 0) {
        node.textContent = text;
        found = true;
        break;
      }
    }

    if (!found) el.textContent = text;
  }

  function removeCheckmark(el) {
    el.querySelectorAll('svg').forEach((svg) => svg.remove());
    el.querySelectorAll('[class*="check"], [class*="Check"], img[src*="check"]').forEach((check) => check.remove());
  }

  // 이중자막이 켜져 있으면 메뉴의 다른 항목 체크 표시를 숨기고, 꺼지면 되돌린다.
  function syncMenuChecks() {
    const dualOpt = document.getElementById('dual-sub-option');
    if (!dualOpt || !dualOpt.parentElement) return;
    dualOpt.parentElement.querySelectorAll('svg, [class*="check"], img[src*="check"]').forEach((el) => {
      if (!el.closest('#dual-sub-option')) el.style.visibility = isEnabled ? 'hidden' : '';
    });
    dualOpt.style.color = isEnabled ? '#56CCF2' : '';
  }

  function applyActiveStyle(el) {
    el.style.color = '#56CCF2';
  }

  const videoObserver = new MutationObserver(() => {
    const newVideo = document.querySelector('video');

    if (!videoEl && newVideo) {
      videoEl = newVideo;
      return;
    }

    if (newVideo && newVideo !== videoEl) {
      videoEl = newVideo;
      resetPlaybackState('video-change', false);

      if (isEnabled) {
        createOverlay();
      }
    }
    if (newVideo && !newVideo.__dualSubHooked) {
      newVideo.__dualSubHooked = true;
      newVideo.addEventListener('playing', () => tryAutoEnable('playing'));
    }
  });
  videoObserver.observe(document.body, { childList: true, subtree: true });

  trackRouteChanges();

  console.log(`[이중자막] Content Script 로드 (${PLATFORM})`);
})();
