(() => {
  'use strict';

  const apiKeyInput = document.getElementById('api-key');
  const modelInput = document.getElementById('model');
  const includeContextInput = document.getElementById('include-context');
  const inlineAIInput = document.getElementById('inline-ai');
  const consentInput = document.getElementById('consent');
  const saveButton = document.getElementById('save');
  const clearButton = document.getElementById('clear');
  const statusEl = document.getElementById('status');
  const connectionState = document.getElementById('connection-state');

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = kind || '';
  }

  function setBusy(busy) {
    saveButton.disabled = busy;
    clearButton.disabled = busy;
  }

  function send(type, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...(payload === undefined ? {} : { payload }) }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, code: 'RUNTIME_ERROR', message: '확장프로그램과 통신하지 못했습니다.' });
            return;
          }
          resolve(response || { ok: false, code: 'EMPTY_RESPONSE', message: '응답을 받지 못했습니다.' });
        });
      } catch {
        resolve({ ok: false, code: 'RUNTIME_ERROR', message: '확장프로그램과 통신하지 못했습니다.' });
      }
    });
  }

  async function loadConfig() {
    const response = await send('STUDY_CONFIG_GET');
    if (!response.ok) {
      connectionState.textContent = '상태를 확인하지 못했습니다';
      setStatus(response.message, 'error');
      return;
    }
    modelInput.value = response.model || 'gemini-2.5-flash';
    includeContextInput.checked = response.includeContext === true;
    inlineAIInput.checked = response.inlineAI === true;
    connectionState.textContent = response.configured ? '연결됨' : '연결되지 않음';
    setStatus('', '');
  }

  saveButton.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      setStatus('API 키를 입력해주세요.', 'error');
      apiKeyInput.focus();
      return;
    }
    if (!consentInput.checked) { setStatus('자막 전송과 비용 안내를 확인한 뒤 체크해주세요.', 'error'); consentInput.focus(); return; }
    // Optional host permission must be requested directly in the button's user gesture.
    let permissionPromise;
    try { permissionPromise = chrome.permissions.request({ origins: ['https://generativelanguage.googleapis.com/*'] }); }
    catch { setStatus('연결 권한을 요청하지 못했습니다.', 'error'); return; }
    setBusy(true);
    setStatus('Gemini 연결 권한을 확인하고 저장하는 중...', '');
    try {
      if (!(await permissionPromise)) { setBusy(false); setStatus('Gemini 연결 권한을 허용해야 저장할 수 있어요.', 'error'); return; }
    } catch { setBusy(false); setStatus('연결 권한을 확인하지 못했습니다.', 'error'); return; }
    const response = await send('STUDY_CONFIG_SAVE', {
      apiKey,
      model: modelInput.value.trim(),
      includeContext: includeContextInput.checked,
      consent: true,
      inlineAI: inlineAIInput.checked,
    });
    setBusy(false);
    if (!response.ok) {
      setStatus(response.message || '저장하지 못했습니다.', 'error');
      return;
    }
    apiKeyInput.value = '';
    connectionState.textContent = '연결됨';
    modelInput.value = response.model || modelInput.value;
    includeContextInput.checked = response.includeContext === true;
    setStatus('저장했습니다. 자동 주석을 켠 경우 OTT 페이지에서 새 자막부터 짧은 주석을 생성합니다.', 'ok');
  });

  clearButton.addEventListener('click', async () => {
    setBusy(true);
    setStatus('연결 정보를 지우는 중...', '');
    const response = await send('STUDY_CONFIG_CLEAR');
    setBusy(false);
    if (!response.ok) {
      setStatus(response.message || '연결 정보를 지우지 못했습니다.', 'error');
      return;
    }
    apiKeyInput.value = '';
    connectionState.textContent = '연결되지 않음';
    setStatus('Gemini 연결 정보와 세션 키를 지웠습니다.', 'ok');
  });

  loadConfig();
})();
