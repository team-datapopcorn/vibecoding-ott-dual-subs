/**
 * Pro 다른 언어 자막 수요 조사 (출시 알림 신청)
 * - 확장은 아무 데이터도 보내지 않는다. 사용자가 버튼을 누르면
 *   언어·OTT만 미리 채운 Google 설문 링크를 새 탭으로 연다.
 * - 실제 제출 여부와 이메일 입력은 사용자가 설문 화면에서 직접 결정한다.
 */
(function (root) {
  const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSf0ZfXBPtCwvHVllnMC47RYa3mrkcX-oSANALsLYVtpK6nanw/viewform';
  const ENTRY_LANGUAGE = 'entry.1118344420';
  const ENTRY_OTT = 'entry.194440251';
  // 설문 보기 문구와 정확히 같아야 미리 채워진다.
  const LANGUAGES = ['일본어', '중국어(간체)', '중국어(번체)', '스페인어', '독일어', '프랑스어', '베트남어'];
  const OTT_BY_HOST = [
    [/(^|\.)coupangplay\.com$/, '쿠팡플레이'],
    [/(^|\.)netflix\.com$/, '넷플릭스'],
  ];

  function ottFromTabUrl(tabUrl) {
    try {
      const host = new URL(tabUrl).hostname;
      for (const [pattern, label] of OTT_BY_HOST) if (pattern.test(host)) return label;
    } catch {}
    return '';
  }

  function buildWaitlistUrl(language, tabUrl) {
    const params = new URLSearchParams({ usp: 'pp_url' });
    if (LANGUAGES.includes(language)) params.append(ENTRY_LANGUAGE, language);
    const ott = ottFromTabUrl(tabUrl || '');
    if (ott) params.append(ENTRY_OTT, ott);
    return `${FORM_URL}?${params.toString()}`;
  }

  function mount(doc, chromeApi) {
    const select = doc.getElementById('pro-language');
    const button = doc.getElementById('pro-waitlist');
    if (!select || !button) return;
    for (const language of LANGUAGES) {
      const option = doc.createElement('option');
      option.value = language;
      option.textContent = language;
      select.appendChild(option);
    }
    button.addEventListener('click', async () => {
      let tabUrl = '';
      try {
        const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
        tabUrl = tab?.url || '';
      } catch {}
      chromeApi.tabs.create({ url: buildWaitlistUrl(select.value, tabUrl) });
    });
  }

  const api = { FORM_URL, LANGUAGES, buildWaitlistUrl, ottFromTabUrl, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OTTDualSubsProWaitlist = api;
  if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.tabs) {
    document.addEventListener('DOMContentLoaded', () => api.mount(document, chrome));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
