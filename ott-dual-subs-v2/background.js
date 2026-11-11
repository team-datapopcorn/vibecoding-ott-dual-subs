/**
 * Background Service Worker
 * - 쿠팡플레이: *.coupangstreaming.com 에서 .vtt 자막 감지
 * - 넷플릭스: *.nflxvideo.net 에서 TTML 자막 감지
 * - 감지된 자막 URL을 Content Script에 전달하여 이중자막 표시
 */

// --- 플랫폼별 자막 감지 규칙 ---
const PLATFORM_RULES = {
  coupangplay: {
    // 쿠팡플레이: /subtitle/ 경로의 .vtt 파일
    test: (url) => url.includes('/subtitle/') && url.includes('.vtt'),
    format: 'vtt',
  },
  netflix: {
    // 넷플릭스: nflxvideo.net에서 오는 TTML 자막
    // 넷플릭스는 URL에 timedtext 힌트가 없을 수 있으므로
    // Content-Type (application/ttml+xml) 또는 응답 크기로 판별
    test: (url) => url.includes('nflxvideo.net'),
    format: 'ttml',
  },
};

const subtitleQueues = new Map();
function withSubtitleQueue(tabId, task) {
  const prior=subtitleQueues.get(tabId)||Promise.resolve();
  const next=prior.catch(()=>{}).then(task);subtitleQueues.set(tabId,next);
  next.finally(()=>{if(subtitleQueues.get(tabId)===next)subtitleQueues.delete(tabId);}).catch(()=>{});
  return next;
}
// --- Storage helpers ---
async function getSubtitles(tabId) {
  const key = `subs_${tabId}`;
  const result = await chrome.storage.session.get(key);
  return result[key] || [];
}

async function setSubtitles(tabId, subs) {
  const key = `subs_${tabId}`;
  await chrome.storage.session.set({ [key]: subs });
}

async function clearSubtitles(tabId) {
  const key = `subs_${tabId}`;
  await chrome.storage.session.remove(key);
}

async function clearPlatform(tabId) {
  const key = `platform_${tabId}`;
  await chrome.storage.session.remove(key);
}

async function getPlatform(tabId) {
  const key = `platform_${tabId}`;
  const result = await chrome.storage.session.get(key);
  return result[key] || 'unknown';
}

async function setPlatform(tabId, platform) {
  const key = `platform_${tabId}`;
  await chrome.storage.session.set({ [key]: platform });
}

// --- 네트워크 요청 감시: 쿠팡플레이 ---
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.tabId < 0) return;
    const url = details.url;

    if (!PLATFORM_RULES.coupangplay.test(url)) return;

    await handleSubtitleDetected(details.tabId, url, 'coupangplay', 'vtt');
  },
  { urls: ['*://*.coupangstreaming.com/*'] }
);

// --- 네트워크 요청 감시: 넷플릭스 ---
// 넷플릭스는 nflxvideo.net에서 자막과 비디오 청크가 모두 옴
// Content-Type 헤더로 자막(ttml+xml, text/xml) vs 비디오(video/mp4) 구분
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.tabId < 0) return;

    const url = details.url;
    const contentType = getHeader(details.responseHeaders, 'content-type') || '';

    // TTML/XML 자막만 필터링
    const isSubtitle =
      contentType.includes('ttml') ||
      contentType.includes('xml') ||
      contentType.includes('text/plain');

    // 비디오/오디오 제외
    const isMedia =
      contentType.includes('video') ||
      contentType.includes('audio') ||
      contentType.includes('octet-stream');

    if (isMedia || !isSubtitle) return;

    await handleSubtitleDetected(details.tabId, url, 'netflix', 'ttml');
  },
  { urls: ['*://*.nflxvideo.net/*'] },
  ['responseHeaders']
);

// 응답 헤더에서 특정 헤더 값 추출
function getHeader(headers, name) {
  if (!headers) return null;
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

// --- 공통: 자막 감지 처리 ---
function handleSubtitleDetected(tabId, url, platform, format) {
  return withSubtitleQueue(tabId, async () => {
  const subs = await getSubtitles(tabId);

  // 중복 방지
  if (subs.some((s) => s.url === url)) return;

  subs.push({
    url,
    format,
    platform,
    detectedAt: Date.now(),
    filename: extractFilename(url),
  });

  await setSubtitles(tabId, subs);
  await setPlatform(tabId, platform);
  updateBadge(tabId, subs.length);

  console.log(`[${platform}] 자막 감지 (${format}): ${url.substring(0, 80)}... (총 ${subs.length}개)`);

  // 한 개도 전달해 준비 상태(1/2)를 표시하고, 두 개가 모이면 활성화합니다.
  if (subs.length > 0) {
    sendSubtitleUrlsToContentScript(tabId, subs);
  }
  });
}

// Content Script에 자막 URL 전달
async function sendSubtitleUrlsToContentScript(tabId, subs) {
  const payload = {
    type: 'SUBTITLE_URLS',
    urls: subs.map((s) => s.url),
    formats: subs.map((s) => s.format),
    platform: subs[0]?.platform || 'unknown',
  };

  try {
    await chrome.tabs.sendMessage(tabId, payload);
    console.log(`[이중자막] Tab ${tabId}에 자막 ${subs.length}개 전달 (${payload.platform})`);
  } catch {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, payload).catch(() => {});
    }, 2000);
  }
}

function resetSubtitleSession(tabId) {
  return withSubtitleQueue(tabId,async()=>{
    await Promise.all([clearSubtitles(tabId),clearPlatform(tabId)]);
    await updateBadge(tabId,0);
  });
}

// URL에서 파일명 추출
function extractFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop();
  } catch {
    return 'subtitle';
  }
}

// 배지 업데이트
async function updateBadge(tabId, count) {
  // onRemoved fires after the tab is gone; badge writes must not reject the worker.
  try {
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
    if (count > 0) await chrome.action.setBadgeBackgroundColor({ color: '#E53935', tabId });
  } catch { /* A closed tab has no badge to update. */ }
}

// 탭 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  resetSubtitleSession(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    resetSubtitleSession(tabId);
  }
});

// 메시지 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SUBTITLES') {
    getSubtitles(message.tabId).then(async (subs) => {
      const platform = await getPlatform(message.tabId);
      sendResponse({ subtitles: subs, platform });
    });
    return true;
  }

  if (message.type === 'GET_MY_SUBTITLES') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse([]); return true; }

    getSubtitles(tabId).then(async (subs) => {
      const platform = await getPlatform(tabId);
      const payload = subs.map((s) => ({ url: s.url, format: s.format }));
      if (subs.length >= 2) {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUBTITLE_URLS',
          urls: subs.map((s) => s.url),
          formats: subs.map((s) => s.format),
          platform,
        }).catch(() => {});
      }
      sendResponse({ subtitles: payload, platform });
    });
    return true;
  }

  if (message.type === 'RESET_SUBTITLE_SESSION') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false });
      return true;
    }

    resetSubtitleSession(tabId).then(() => {
      console.log(`[이중자막] Tab ${tabId} 자막 세션 초기화 (${message.reason || 'unknown'})`);
      sendResponse({ ok: true });
    });
    return true;
  }
});

importScripts('credential-reload.js', 'phrase-dictionary.js', 'study-ai.js');
