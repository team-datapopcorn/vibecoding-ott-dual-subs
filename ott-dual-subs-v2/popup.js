document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('study-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  const aiStatusLine=document.getElementById('ai-status-line');
  chrome.runtime.sendMessage({type:'STUDY_STATUS'},response=>{
    if(chrome.runtime.lastError||!response?.ok){aiStatusLine.textContent='확장 연결을 확인해주세요.';return;}
    const view=OTTDualSubsAnnotationStatus.describe(response,{code:'idle'},response.depth||'medium');
    aiStatusLine.textContent=view.connection+' · '+view.depth;aiStatusLine.title=view.title;
  });
  // --- DOM 참조 ---
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statusCount = document.getElementById('status-count');
  const dualSubToggle = document.getElementById('dual-sub-toggle');
  const previewBox = document.getElementById('preview-box');
  const enSizeSlider = document.getElementById('en-size');
  const koSizeSlider = document.getElementById('ko-size');
  const enSizeVal = document.getElementById('en-size-val');
  const koSizeVal = document.getElementById('ko-size-val');
  const enColorSelect = document.getElementById('en-color');
  const subPositionSelect = document.getElementById('sub-position');
  const dlHeader = document.getElementById('dl-header');
  const dlBody = document.getElementById('dl-body');
  const dlArrow = document.getElementById('dl-arrow');
  let preferenceTab = null;
  const depthSelect = document.getElementById('annotation-depth');
  depthSelect.addEventListener('change', async()=>{
    const saved=await chrome.storage.local.get('dualSettings');
    const st={...(saved.dualSettings||{}),annotationDepth:depthSelect.value};
    await chrome.storage.local.set({dualSettings:st});
    if(preferenceTab)chrome.tabs.sendMessage(preferenceTab.id,{type:'UPDATE_SETTINGS',settings:{annotationDepth:depthSelect.value}},()=>void chrome.runtime.lastError);
  });
  const inlineNotes = document.getElementById('inline-notes');
  const subLangSelect = document.getElementById('sub-lang');
  const subLangStatus = document.getElementById('sub-lang-status');
  subLangSelect.addEventListener('change', async () => {
    const saved = await chrome.storage.local.get('dualSettings');
    const st = { ...(saved.dualSettings || {}), subLang: subLangSelect.value };
    await chrome.storage.local.set({ dualSettings: st });
    if (preferenceTab) chrome.tabs.sendMessage(preferenceTab.id, { type: 'UPDATE_SETTINGS', settings: { subLang: subLangSelect.value } }, () => void chrome.runtime.lastError);
    subLangStatus.textContent = subLangSelect.value === 'ja' ? '일본어로 바꿨어요. 재생 중이면 지금 장면부터 번역해요.' : '영어 원문 자막으로 바꿨어요.';
  });
  const dlList = document.getElementById('dl-list');

  // --- 저장된 자막 설정 반영 (다음 편에도 같은 크기·색·위치) ---
  try {
    const saved = await chrome.storage.local.get('dualSettings');
    const st = saved.dualSettings;
    depthSelect.value=['strong','medium','weak'].includes(st?.annotationDepth)?st.annotationDepth:'medium';
    inlineNotes.checked = st?.inlineNotes !== false;
    subLangSelect.value = st?.subLang === 'ja' ? 'ja' : 'en';
    if (st) {
      if (st.enFontSize) { enSizeSlider.value = st.enFontSize; enSizeVal.textContent = st.enFontSize + 'px'; }
      if (st.koFontSize) { koSizeSlider.value = st.koFontSize; koSizeVal.textContent = st.koFontSize + 'px'; }
      if (st.enColor) enColorSelect.value = st.enColor;
      if (st.position) subPositionSelect.value = st.position;
    }
  } catch {}

  // --- 현재 탭 ---
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  preferenceTab=tab;

  // 지원 플랫폼 확인
  const isCoupang = tab?.url?.includes('coupangplay.com');
  const isNetflix = tab?.url?.includes('netflix.com');
  const isSupported = isCoupang || isNetflix;
  const platformName = isCoupang ? '쿠팡플레이' : isNetflix ? '넷플릭스' : '';

  if (!tab || !isSupported) {
    statusText.textContent = '지원 플랫폼이 아닙니다';
    dualSubToggle.disabled = true;
    previewBox.innerHTML = '<div class="preview-off">쿠팡플레이 또는 넷플릭스에서<br>영상을 재생해주세요</div>';
    return;
  }

  // 플랫폼 표시
  statusText.textContent = `${platformName} · 자막 감지 대기 중...`;

  // --- 이중자막 상태 가져오기 ---
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_DUAL_SUB_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      dualSubToggle.checked = res.enabled;
      updatePreview(res.enabled);
      const tr = res.translation;
      const describe = (plan, st) => {
        if (!plan || plan.kind !== 'ai' || !st || !st.lang) return '';
        const name = plan.to === 'ja' ? '일본어' : plan.to === 'en' ? '영어' : '한국어';
        const how = plan.to === 'ja' ? '번역' : '자막이 없어 AI로 생성';
        if (st.state === 'working') return `${name} ${how} 중 ${st.done}/${st.total}줄`;
        if (st.state === 'ready') return `${name} ${plan.to === 'ja' ? '번역' : 'AI 생성'} 완료 (${st.total}줄)`;
        if (st.state === 'partial') return `${name} 일부 실패 (${st.done}/${st.total}줄)`;
        if (st.state === 'error') return `${name}: 서버에 연결하지 못했어요`;
        if (st.state === 'limit') return st.code === 'USER_LIMIT' || st.code === 'DAILY_LIMIT' ? '오늘 무료 AI 자막 한도에 도달했어요. 내일 다시 이용할 수 있어요.' : `${name}: AI 자막을 쓸 수 없어요`;
        return '';
      };
      if (tr && tr.plan) {
        subLangStatus.textContent = [describe(tr.plan.top, tr.top), describe(tr.plan.bottom, tr.bottom)].filter(Boolean).join(' · ');
      }
    });
  } catch {}

  // --- 자막 감지 상태 ---
  chrome.runtime.sendMessage({ type: 'GET_SUBTITLES', tabId: tab.id }, (response) => {
    const subtitles = response?.subtitles || [];
    const platform = response?.platform || 'unknown';

    if (subtitles.length === 0) {
      statusDot.className = 'status-dot inactive';
      statusText.textContent = `${platformName} · 자막 감지 대기 중...`;
      statusCount.textContent = '';
    } else {
      statusDot.className = 'status-dot active';
      statusText.textContent = `${platformName} · 자막 감지됨`;
      statusCount.textContent = `${subtitles.length}개`;

      // 다운로드 목록 채우기
      subtitles.forEach((sub, i) => {
        const lang = guessLanguage(sub, i, subtitles.length);
        const label = lang === 'ko' ? '한국어' : lang === 'en' ? 'English' : lang;
        const baseName = (extractTitleFromUrl(tab.url) || 'subtitle') + '_' + lang;
        const subFormat = sub.format || 'vtt';

        // 원본 형식 다운로드
        const origBtn = document.createElement('button');
        origBtn.className = 'dl-btn';
        origBtn.textContent = `${label} ${subFormat.toUpperCase()} 다운로드`;
        origBtn.addEventListener('click', () => downloadSubtitle(sub.url, subFormat, baseName, origBtn));
        dlList.appendChild(origBtn);

        // SRT 변환 다운로드 (VTT인 경우만)
        if (subFormat === 'vtt') {
          const srtBtn = document.createElement('button');
          srtBtn.className = 'dl-btn';
          srtBtn.textContent = `${label} SRT 다운로드`;
          srtBtn.addEventListener('click', () => downloadSubtitle(sub.url, 'srt', baseName, srtBtn));
          dlList.appendChild(srtBtn);
        }
      });
    }
  });

  // --- 이중자막 토글 ---
  dualSubToggle.addEventListener('change', () => {
    const enabled = dualSubToggle.checked;
    updatePreview(enabled);
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DUAL_SUBS', enabled });
  });

  function updatePreview(enabled) {
    if (enabled) {
      previewBox.innerHTML = `
        <div class="preview-en" style="color:${enColorSelect.value}">English subtitle here</div>
        <div class="preview-ko">한국어 자막이 여기에 표시됩니다</div>
      `;
    } else {
      previewBox.innerHTML = '<div class="preview-off">이중자막이 꺼져 있습니다</div>';
    }
  }

  // --- 설정: 자막 크기 ---
  enSizeSlider.addEventListener('input', () => {
    enSizeVal.textContent = enSizeSlider.value + 'px';
    sendSettings();
  });
  koSizeSlider.addEventListener('input', () => {
    koSizeVal.textContent = koSizeSlider.value + 'px';
    sendSettings();
  });

  // --- 설정: 영어 자막 색상 ---
  enColorSelect.addEventListener('change', () => {
    updatePreview(dualSubToggle.checked);
    sendSettings();
  });

  // --- 설정: 자막 위치 ---
  subPositionSelect.addEventListener('change', () => {
    sendSettings();
  });

  function sendSettings() {
    const settings = {
      enFontSize: parseInt(enSizeSlider.value),
      koFontSize: parseInt(koSizeSlider.value),
      enColor: enColorSelect.value,
      position: subPositionSelect.value,
      inlineNotes: inlineNotes.checked,
      annotationDepth: depthSelect.value,
      subLang: subLangSelect.value,
    };
    chrome.storage.local.set({ dualSettings: settings });
    chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_SETTINGS', settings }, () => void chrome.runtime.lastError);
  }

  inlineNotes.addEventListener('change', sendSettings);
  // --- 다운로드 섹션 접기/펼치기 ---
  dlHeader.addEventListener('click', () => {
    const isOpen = dlBody.classList.toggle('open');
    dlArrow.textContent = isOpen ? '▾' : '▸';
  });
});

// === 유틸리티 ===

function guessLanguage(sub, index, total) {
  const url = sub.url.toLowerCase();
  if (url.includes('_ko') || url.includes('/ko/')) return 'ko';
  if (url.includes('_en') || url.includes('/en/')) return 'en';
  if (total === 2) return index === 0 ? 'ko' : 'en';
  return `sub${index + 1}`;
}

function extractTitleFromUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    // 쿠팡플레이
    const titleId = url.searchParams.get('titleId');
    if (titleId) return titleId.substring(0, 8);
    // 넷플릭스: /watch/12345678
    const match = url.pathname.match(/\/watch\/(\d+)/);
    if (match) return match[1].substring(0, 8);
  } catch {}
  return null;
}

async function downloadSubtitle(url, format, baseName, btnEl) {
  const originalText = btnEl.textContent;
  btnEl.textContent = '다운로드 중...';
  btnEl.disabled = true;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();

    let content = text;
    let filename = `${baseName}.${format}`;

    if (format === 'srt') {
      content = vttToSrt(text);
      filename = `${baseName}.srt`;
    }

    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);

    btnEl.textContent = '완료!';
    setTimeout(() => { btnEl.textContent = originalText; btnEl.disabled = false; }, 1500);
  } catch (err) {
    console.error('다운로드 실패:', err);
    btnEl.textContent = '실패';
    btnEl.disabled = false;
  }
}
