// ============================================================
// inject.js - MAIN world에서 실행
// fetch/XHR 인터셉트 → 자막 데이터를 content.js로 전달
// ============================================================
(() => {
  'use strict';

  const LOG = '[DualSub:inject]';

  // 원본 fetch 보존
  const _originalFetch = window.fetch;

  function isSubtitleUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('.vtt') ||
      lower.includes('.srt') ||
      lower.includes('.ttml') ||
      (lower.includes('.xml') && (lower.includes('subtitle') || lower.includes('caption') || lower.includes('text'))) ||
      lower.includes('subtitle') ||
      lower.includes('caption') ||
      lower.includes('/text/') ||
      lower.includes('webvtt') ||
      (lower.includes('.m3u8') && lower.includes('sub'))
    );
  }

  // --- fetch 오버라이드 ---
  window.fetch = async function (...args) {
    const response = await _originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (isSubtitleUrl(url)) {
        console.log(LOG, 'Subtitle fetch intercepted:', url);
        const clone = response.clone();
        clone.text().then(text => {
          window.postMessage({
            type: 'DUAL_SUB_SUBTITLE_DATA',
            payload: { text, url },
          }, '*');
        }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
    return response;
  };

  // --- XHR 오버라이드 ---
  const _originalOpen = XMLHttpRequest.prototype.open;
  const _originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._dualSubUrl = typeof url === 'string' ? url : url?.toString?.() || '';
    return _originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._dualSubUrl && isSubtitleUrl(this._dualSubUrl)) {
      console.log(LOG, 'Subtitle XHR intercepted:', this._dualSubUrl);
      const url = this._dualSubUrl;
      this.addEventListener('load', function () {
        try {
          window.postMessage({
            type: 'DUAL_SUB_SUBTITLE_DATA',
            payload: { text: this.responseText, url },
          }, '*');
        } catch (e) { /* ignore */ }
      });
    }
    return _originalSend.apply(this, args);
  };

  // 번역 요청 처리 (content.js에서 CORS 문제 회피를 위해)
  window.addEventListener('message', async (event) => {
    if (event.data?.type === 'DUAL_SUB_TRANSLATE_REQUEST') {
      const { text, from, to, requestId } = event.data.payload;
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await _originalFetch(url);
        const data = await res.json();
        const translated = data[0].map(s => s[0]).join('');
        window.postMessage({
          type: 'DUAL_SUB_TRANSLATE_RESPONSE',
          payload: { translated, requestId },
        }, '*');
      } catch (e) {
        window.postMessage({
          type: 'DUAL_SUB_TRANSLATE_RESPONSE',
          payload: { translated: '', requestId },
        }, '*');
      }
    }
  });

  console.log(LOG, 'Network intercept installed');
})();
