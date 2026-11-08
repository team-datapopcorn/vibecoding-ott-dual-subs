(() => {
  'use strict';

  const depthSelect = document.getElementById('annotation-depth');
  const depthStatus = document.getElementById('depth-status');
  const dictList = document.getElementById('dictionary-list');
  const dictQuery = document.getElementById('dictionary-query');
  const dictStats = document.getElementById('dictionary-stats');
  const dictStatus = document.getElementById('dictionary-status');
  let dictOffset=0, dictToken=0, searchTimer;
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

  function send(type, payload, extra = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...(payload === undefined ? {} : { payload }), ...extra }, (response) => {
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
    depthSelect.value = ['strong','medium','weak'].includes(response.depth) ? response.depth : 'medium';
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

  depthSelect.addEventListener('change', async () => {
    const response=await send('STUDY_DEPTH_SET',undefined,{depth:depthSelect.value});
    depthStatus.textContent=response.ok?'깊이를 저장했습니다. 현재 자막부터 적용해요.':response.message;
  });
  async function loadDictionary() {
    const token=++dictToken;
    const response=await send('STUDY_DICTIONARY_LIST',undefined,{query:dictQuery.value,offset:dictOffset});
    if(token!==dictToken)return;
    dictList.replaceChildren();
    if(!response.ok){dictStats.textContent=response.message||'사전을 불러오지 못했습니다.';return;}
    const stats=response.stats||{};
    dictStats.textContent='총 '+(stats.total||0)+'개 · 기본 '+(stats.builtin||0)+'개 · 새로 저장 '+(stats.learned||0)+'개 · 재사용 '+(stats.reuses||0)+'회';
    for(const entry of response.entries||[]){
      const row=document.createElement('article');row.className='dict-entry';
      if(entry.source==='ai'){
        const button=document.createElement('button');button.className='dict-delete';button.type='button';button.textContent='삭제';button.setAttribute('aria-label',entry.expression+' 사전에서 삭제');
        button.addEventListener('click',async()=>{button.disabled=true;const result=await send('STUDY_DICTIONARY_REMOVE',undefined,{id:entry.id});dictStatus.textContent=result.ok?'직접 저장한 사전 항목을 삭제했습니다.':result.message;await loadDictionary();});row.append(button);
      }
      for(const [tag,cls,text] of [['strong','',entry.expression],['div','dict-meta',(entry.kind==='term'?'전문용어':'주요 표현')+' · '+(entry.source==='builtin'?'기본 사전':'AI 저장')],['div','dict-meaning',entry.meaning],['div','dict-note',entry.note]]){
        const part=document.createElement(tag);part.className=cls;part.textContent=text;row.append(part);
      }
      dictList.append(row);
    }
    if(!response.entries?.length){const empty=document.createElement('p');empty.className='help';empty.textContent='검색 결과가 없습니다.';dictList.append(empty);}
    document.getElementById('dictionary-prev').disabled=dictOffset===0;
    document.getElementById('dictionary-next').disabled=dictOffset+30>=response.total;
    document.getElementById('dictionary-page').textContent=(response.total?Math.floor(dictOffset/30)+1:0)+' / '+Math.ceil(response.total/30);
  }
  dictQuery.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{dictOffset=0;loadDictionary();},180);});
  document.getElementById('dictionary-prev').addEventListener('click',()=>{dictOffset=Math.max(0,dictOffset-30);loadDictionary();});
  document.getElementById('dictionary-next').addEventListener('click',()=>{dictOffset+=30;loadDictionary();});
  loadConfig();loadDictionary();
})();
