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
    subLang: 'en', // 'en' = 영어 원문, 'ja' = 일본어 무료 베타(영어 자막을 AI 번역)
  };

  // === AI 자막 생성·번역 (무료 베타) ===
  // 위 줄(영어/일본어)과 아래 줄(한국어) 중 OTT가 주지 않는 자막은 AI로 만들어 채운다.
  const betaApi = globalThis.OTTDualSubsTranslateBeta;
  let renderEpoch = 0;
  let betaBadgeEl = null;
  let linePlan = { top: null, bottom: null };
  const SINGLE_TRACK_WAIT_MS = 8000;
  let singleTrackTimer = null;
  let singleTrackReadyUrl = '';
  let singleTrackExtended = false;

  function betaRequest(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(chrome.runtime.lastError ? { ok: false, code: 'RUNTIME_ERROR' } : response);
        });
      } catch { resolve({ ok: false, code: 'RUNTIME_ERROR' }); }
    });
  }
  const topTranslator = betaApi ? betaApi.createTranslator({ request: betaRequest, onChange: () => { renderEpoch += 1; } }) : null;
  const bottomTranslator = betaApi ? betaApi.createTranslator({ request: betaRequest, onChange: () => { renderEpoch += 1; } }) : null;

  function betaLang() {
    return betaApi && betaApi.isBetaLang(settings.subLang) ? settings.subLang : '';
  }

  function dualLabel() {
    return betaLang() === 'ja' ? '한국어+日本語' : '한국어+영어';
  }

  function sourceCues(lang) {
    return lang === 'ko' ? koCues : enCues;
  }

  function syncOne(translator, plan) {
    if (!translator) return;
    const current = translator.status();
    if (!plan || plan.kind !== 'ai' || !isEnabled) {
      if (current.lang) { translator.stop(); renderEpoch += 1; }
      return;
    }
    const cues = sourceCues(plan.from);
    if (current.src === plan.from && current.lang === plan.to && current.total === cues.length) return;
    translator.start(cues, plan.to, () => (videoEl ? videoEl.currentTime : 0), plan.from);
    renderEpoch += 1;
  }

  function syncTranslation() {
    linePlan = betaApi
      ? betaApi.planLines({ koReal: koCues.length > 0, enReal: enCues.length > 0, subLang: settings.subLang })
      : { top: enCues.length ? { kind: 'real', from: 'en' } : null, bottom: koCues.length ? { kind: 'real', from: 'ko' } : null };
    if (!annotationsAllowed()) annotationController?.clear();
    syncOne(topTranslator, linePlan.top);
    syncOne(bottomTranslator, linePlan.bottom);
    renderEpoch += 1;
  }

  // 영어 표현 주석은 실제 영어·한국어 자막이 모두 있고 위 줄이 영어 원문일 때만 쓴다.
  function annotationsAllowed() {
    return linePlan.top?.kind === 'real' && linePlan.bottom?.kind === 'real';
  }

  function aiStatusText(plan, status) {
    if (!plan || plan.kind !== 'ai' || !status || !status.lang) return '';
    const target = plan.to === 'ja' ? '日本語 베타' : plan.to === 'en' ? '영어 자막이 없어 AI로' : '한국어 자막이 없어 AI로';
    const verb = plan.to === 'ja' ? '번역' : '만드는';
    if (status.state === 'working') return plan.to === 'ja' ? `${target} · AI 번역 중 ${status.done}/${status.total}` : `${target} ${verb} 중 ${status.done}/${status.total}`;
    if (status.state === 'limit') {
      return status.code === 'USER_LIMIT' || status.code === 'DAILY_LIMIT'
        ? '오늘 무료 AI 자막 한도에 도달했어요. 내일 다시 이용할 수 있어요'
        : 'AI 자막을 쓸 수 없어요';
    }
    if (status.state === 'error' || status.state === 'partial') return `AI 자막 일부 실패 (${status.done}/${status.total})`;
    if (status.state === 'ready') return plan.to === 'ja' ? '' : 'AI 생성 자막';
    return '';
  }

  function betaBadgeText() {
    const parts = [
      aiStatusText(linePlan.top, topTranslator?.status()),
      aiStatusText(linePlan.bottom, bottomTranslator?.status()),
    ].filter(Boolean);
    return [...new Set(parts)].join(' · ');
  }

  // 자막이 하나만 잡힐 때: 잠시 기다렸다가(두 번째 자막이 올 수 있으므로) 하나로도 켠다.
  function listedTrackLangs() {
    const out = new Set();
    try {
      for (const track of Array.from(videoEl?.textTracks || [])) {
        const code = String(track.language || '').toLowerCase();
        const label = String(track.label || '');
        if (code.startsWith('en') || /english|영어/i.test(label)) out.add('en');
        if (code.startsWith('ko') || /korean|한국어/i.test(label)) out.add('ko');
      }
    } catch {}
    return out;
  }

  function wakeListedTracks() {
    try {
      for (const track of Array.from(videoEl?.textTracks || [])) {
        const code = String(track.language || '').toLowerCase();
        if ((code.startsWith('en') || code.startsWith('ko')) && track.mode === 'disabled') track.mode = 'hidden';
      }
    } catch {}
  }

  function hasEnoughTracks() {
    return subtitleUrls.length >= 2 || (subtitleUrls.length === 1 && singleTrackReadyUrl === subtitleUrls[0]);
  }

  function markSingleTrackReady(reason) {
    if (subtitleUrls.length !== 1) return;
    singleTrackReadyUrl = subtitleUrls[0];
    console.log(`[이중자막][${PLATFORM}] 자막 1개로 시작 (${reason}) — 없는 언어는 AI로 생성`);
    if (isEnabled) reloadActiveSubtitles('single-track').catch(() => {});
    else tryAutoEnable('single-track');
  }

  function scheduleSingleTrack() {
    clearTimeout(singleTrackTimer);
    if (subtitleUrls.length !== 1 || singleTrackReadyUrl === subtitleUrls[0]) return;
    const url = subtitleUrls[0];
    wakeListedTracks();
    singleTrackTimer = setTimeout(() => {
      if (subtitleUrls.length !== 1 || subtitleUrls[0] !== url) return;
      // 플레이어 목록에 영어·한국어가 모두 있으면 한 번 더 기다린다(실제 자막이 더 정확하므로).
      if (!singleTrackExtended && listedTrackLangs().size >= 2) {
        singleTrackExtended = true;
        wakeListedTracks();
        scheduleSingleTrack();
        return;
      }
      markSingleTrackReady('timeout');
    }, SINGLE_TRACK_WAIT_MS);
  }

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
      if(area==='local' && changes.studyGeminiConfig)annotationController?.refreshStatus({force:true});
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
      } else { createWaitingIndicator(); }
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
        hasSubtitles: hasEnoughTracks(),
        platform: PLATFORM,
        subLang: settings.subLang,
        translation: {
          plan: linePlan,
          top: topTranslator ? topTranslator.status() : null,
          bottom: bottomTranslator ? bottomTranslator.status() : null,
        },
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

    setInnerText(dualOption, dualLabel());
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

    // 사용자가 직접 켰는데 자막이 하나뿐이면 기다리지 않고 바로 시작한다.
    if (!(await ensureSubtitleSources()) && subtitleUrls.length === 1) singleTrackReadyUrl = subtitleUrls[0];
    if (!hasEnoughTracks()) {
      isEnabled = false;
      console.warn(`[이중자막][${PLATFORM}] 자막 2개 미만, 이중자막 불가`);
      return;
    }

    console.log(`[이중자막][${PLATFORM}] 활성화`);
    await loadCurrentSubtitleSet('manual-enable');
  }

  async function ensureSubtitleSources() {
    if (hasEnoughTracks()) {
      return true;
    }

    console.log(`[이중자막][${PLATFORM}] 자막 URL 부족 — Background에 요청`);
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_MY_SUBTITLES' }, (response) => resolve(response || {}));
      });

      if (res.subtitles && res.subtitles.length > 0) {
        applySubtitleSourceUpdate(
          res.subtitles.map((subtitle) => subtitle.url),
          res.subtitles.map((subtitle) => subtitle.format),
          'background-sync'
        );
      }
    } catch {}

    return hasEnoughTracks();
  }

  async function reloadActiveSubtitles(reason) {
    if (!isEnabled) return;

    console.log(`[이중자막][${PLATFORM}] 자막 세트 변경 감지 — 재로딩 (${reason})`);
    resetLoadedCues();
    await loadCurrentSubtitleSet(reason);
  }

  async function loadCurrentSubtitleSet(reason) {
    if (!hasEnoughTracks()) return;

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
      if (!koCues.length && !enCues.length) { isEnabled = false; return; }

      createOverlay();
      if (overlayEl) overlayEl.style.display = 'flex';
      setNativeSubsHidden(true);
      syncMenuChecks();
      startRendering();
      syncTranslation();
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
    if (subtitleUrls.length === 1) scheduleSingleTrack();
    else clearTimeout(singleTrackTimer);

    if (update.changed) {
      console.log(`[이중자막][${PLATFORM}] 자막 세트 갱신 (${reason}): ${subtitleUrls.length}개`);
    }

    return update.changed;
  }

  function resetLoadedCues() {
    koCues = [];
    enCues = [];
    topTranslator?.stop();
    bottomTranslator?.stop();
    linePlan = { top: null, bottom: null };
    renderEpoch += 1;
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
    clearTimeout(singleTrackTimer);
    singleTrackReadyUrl = '';
    singleTrackExtended = false;
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
    const detect = betaApi ? betaApi.detectLang : (cues) => (isKorean(cues) ? 'ko' : 'en');
    const tagged = allCues.map((cues) => ({ cues, lang: detect(cues) })).filter((item) => item.cues.length > 0);
    for (const item of tagged) {
      if (item.lang === 'ko' && !koCues.length) koCues = item.cues;
      else if (item.lang === 'en' && !enCues.length) enCues = item.cues;
    }
    // 언어를 못 가린 트랙은 예전처럼 남은 자리에 넣는다.
    for (const item of tagged) {
      if (item.cues === koCues || item.cues === enCues || item.lang === 'ja') continue;
      if (!enCues.length && item.lang !== 'ko') enCues = item.cues;
      else if (!koCues.length && item.lang !== 'en') koCues = item.cues;
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
  function findVideoContainer() {
    return (PLATFORM === 'netflix' && (videoEl.closest('.watch-video--player-view') || videoEl.closest('[data-uia="video-canvas"]'))) || videoEl.closest('[class*="player"]') || videoEl.parentElement;
  }
  function createWaitingIndicator() {
    if(!autoEnable||!globalThis.OTTDualSubsAnnotations)return;
    videoEl=document.querySelector('video');if(!videoEl)return;
    if(!annotationController){
      const container=findVideoContainer();
      if(getComputedStyle(container).position==='static')container.style.position='relative';
      enTextEl=document.createElement('span');koTextEl=document.createElement('span');
      annotationController=globalThis.OTTDualSubsAnnotations.mount({container,englishEl:enTextEl,koreanEl:koTextEl,getVideo:()=>videoEl,getSettings:()=>settings,request:message=>new Promise(resolve=>{try{chrome.runtime.sendMessage(message,response=>{resolve(chrome.runtime.lastError?{ok:false,code:'RUNTIME_ERROR'}:response);});}catch{resolve({ok:false,code:'RUNTIME_ERROR'});}})});
    }
    annotationController.waitForTracks(subtitleUrls.length);
  }
  function createOverlay() {
    annotationController?.destroy(); annotationController = null;
    const existing = document.getElementById('dual-sub-overlay');
    if (existing) existing.remove();

    videoEl = document.querySelector('video');
    if (!videoEl) {
      setTimeout(createOverlay, 1000);
      return;
    }

    const videoContainer = findVideoContainer();

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

    betaBadgeEl = document.createElement('div');
    betaBadgeEl.id = 'dual-sub-beta-status';
    betaBadgeEl.style.cssText = `
      display: none; font: 600 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #FFE082; background: rgba(0,0,0,0.55); border-radius: 10px; padding: 2px 10px;
    `;

    enTextEl = document.createElement('div');
    enTextEl.id = 'dual-sub-en';
    enTextEl.style.cssText = `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', sans-serif;
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

    overlayEl.appendChild(betaBadgeEl);
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
              resolve(failed ? { ok: false, code:'RUNTIME_ERROR' } : response);
            });
          } catch { resolve({ ok: false, code:'RUNTIME_ERROR' }); }
        }),
      });
    }
    console.log(`[이중자막][${PLATFORM}] 오버레이 생성`);
  }

  function applySettings() {
    const dualOpt = document.getElementById('dual-sub-option');
    if (dualOpt) setInnerText(dualOpt, dualLabel());
    if (isEnabled && (koCues.length || enCues.length)) syncTranslation();
    if (!annotationsAllowed()) annotationController?.clear();
    else if (annotationController && videoEl) annotationController.update(globalThis.OTTDualSubsStudy?.buildContext(enCues, koCues, videoEl.currentTime));
    renderEpoch += 1;
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

    let lastKo = null;
    let lastEn = null;
    let lastAnnotationCue = '';
    let lastEpoch = -1;
    const indexCache = { en: { cue: null, index: -1 }, ko: { cue: null, index: -1 } };

    function cueIndex(lang, cue) {
      const slot = indexCache[lang];
      if (slot.cue !== cue) { slot.cue = cue; slot.index = cue ? sourceCues(lang).indexOf(cue) : -1; }
      return slot.index;
    }

    // plan에 따라 한 줄의 글자와 상태를 만든다.
    function lineText(plan, translator, time) {
      if (!plan) return { text: '', lang: '', pending: false };
      const cue = findActiveCue(sourceCues(plan.from), time);
      if (!cue) return { text: '', lang: '', pending: false };
      if (plan.kind === 'real') return { text: cue.text, lang: plan.from, pending: false };
      const translated = translator?.textAt(cueIndex(plan.from, cue));
      if (typeof translated === 'string' && translated) return { text: translated, lang: plan.to, pending: false };
      // 번역 전: 영어 원문이 있으면 흐리게 먼저 보여 주고, 한국어 원문은 아래 줄과 겹치므로 비워 둔다.
      if (plan.from === 'en' && plan.to !== 'ko') return { text: cue.text, lang: 'en', pending: true };
      return { text: '', lang: '', pending: true };
    }

    function render() {
      if (!videoEl || !overlayEl || !isEnabled) {
        animFrameId = requestAnimationFrame(render);
        return;
      }

      const time = videoEl.currentTime;
      const top = lineText(linePlan.top, topTranslator, time);
      const bottom = lineText(linePlan.bottom, bottomTranslator, time);
      const epochChanged = renderEpoch !== lastEpoch;

      if (bottom.text !== lastKo || epochChanged) {
        koTextEl.textContent = bottom.text;
        koTextEl.lang = bottom.lang || 'ko';
        koTextEl.style.opacity = bottom.pending ? '0.7' : '1';
        lastKo = bottom.text;
      }
      if (top.text !== lastEn || epochChanged) {
        enTextEl.textContent = top.text;
        enTextEl.lang = top.lang || 'en';
        enTextEl.style.opacity = top.pending ? '0.7' : '1';
        lastEn = top.text;
      }
      if (epochChanged) {
        lastEpoch = renderEpoch;
        // 영어 표현 주석은 실제 영어·한국어 자막이 있고 위 줄이 영어일 때만 보인다.
        const annotationHost = document.getElementById('dual-sub-annotations');
        if (annotationHost) annotationHost.style.display = annotationsAllowed() ? '' : 'none';
        if (betaBadgeEl) {
          const badge = betaBadgeText();
          betaBadgeEl.textContent = badge;
          betaBadgeEl.style.display = badge ? 'block' : 'none';
        }
      }

      if (annotationsAllowed()) {
        const enCue = findActiveCue(enCues, time);
        const annotationCue = enCue ? enCue.startTime + ':' + enCue.endTime : '';
        if (annotationCue !== lastAnnotationCue) {
          lastAnnotationCue = annotationCue;
          annotationController?.update(globalThis.OTTDualSubsStudy?.buildContext(enCues, koCues, time));
        }
      } else {
        lastAnnotationCue = '';
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
    if(autoEnable&&!isEnabled&&!hasEnoughTracks())createWaitingIndicator();
  });
  videoObserver.observe(document.body, { childList: true, subtree: true });

  trackRouteChanges();

  console.log(`[이중자막] Content Script 로드 (${PLATFORM})`);
})();
