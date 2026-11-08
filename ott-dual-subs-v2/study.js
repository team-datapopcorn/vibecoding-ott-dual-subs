/* Local, opt-in language study UI. No network or credentials in this content script. */
(function (root) {
  'use strict';
  const clean = (value, max = 800) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const normalize = (value) => clean(value).toLowerCase().replace(/[.,!?;:]+$/g, '');

  function buildContext(enCues, koCues, time, selection = '') {
    const index = enCues.findIndex((cue) => cue.startTime <= time && time < cue.endTime);
    if (index < 0) return null;
    const current = enCues[index];
    // Korean and English cue boundaries often differ. Only use overlapping Korean cues.
    const korean = koCues.filter((cue) => cue.startTime < current.endTime && cue.endTime > current.startTime).map((cue) => cue.text).join(' ');
    const english = clean(current.text);
    const selected = clean(selection, 240);
    return {
      english,
      korean: clean(korean),
      previous: clean(enCues[index - 1]?.text, 400),
      next: clean(enCues[index + 1]?.text, 400),
      selection: selected && normalize(english).includes(normalize(selected)) ? selected : '',
    };
  }

  function localExplanation(context) {
    if (normalize(context?.english) !== 'the actionable intel comes with a tight clock') return null;
    return {
      summary: '당장 행동에 옮길 만한 정보는 있지만, 움직일 시간이 별로 없다는 뜻이에요.',
      translationNote: '영어는 정보의 성격(actionable)과 시간 제약을 함께 말해요. 한글 자막은 이를 “정보를 입수했는데 시간이 촉박해”로 자연스럽게 압축했어요. “입수했는데”는 intel의 사전 뜻이 아니라 문장 전체를 풀어낸 표현이에요.',
      phrases: [
        {
          expression: 'actionable intel', meaning: '실제로 조치를 취할 수 있는 구체적인 정보·첩보',
          breakdown: 'intel은 intelligence의 줄임말이에요. 이 용법에서는 “지능”이 아니라 “정보·첩보”예요. actionable은 정보를 근거로 행동에 옮길 수 있다는 뜻을 더해요.',
          translationNote: '자막의 “정보”에는 actionable의 의미가 따로 드러나지 않아요. 그냥 아는 사실보다 “이걸 바탕으로 움직일 수 있다”는 뉘앙스가 있어요.',
          exampleEn: 'We need actionable intel, not rumors.', exampleKo: '소문 말고, 실제로 움직일 수 있는 정보가 필요해.',
        },
        {
          expression: 'comes with', meaning: '~이 함께 따르다, ~을 동반하다',
          breakdown: '물건이 “함께 온다”는 뜻에서 확장되어, 어떤 일에 조건·부담·책임이 따라붙을 때도 써요. 여기서는 정보에 시간 제약이 따라붙는다는 뜻이에요.',
          translationNote: '한국어에서는 “시간 제약이 따라붙는 정보”보다 “정보를 입수했는데 시간이 촉박해”가 대사로 더 자연스러워요.',
          exampleEn: 'This job comes with a lot of pressure.', exampleKo: '이 일에는 상당한 압박이 따라.',
        },
        {
          expression: 'with a tight clock', meaning: '시간 여유가 거의 없는 상태로',
          breakdown: 'tight는 옷이 “꽉 끼는” 것처럼 시간이나 예산에 쓰면 “빠듯한”이라는 뜻이에요. clock은 여기서 시계 물건보다 제한 시간·남은 시간을 가리켜요.',
          translationNote: '이 문장에서 with는 comes with에 연결돼요. with a tight clock 전체를 무조건 외울 고정 숙어로 보기보다, comes with + a tight clock으로 읽으면 이해하기 쉬워요.',
          exampleEn: "We're working on a tight deadline.", exampleKo: '우리는 마감 시간이 빠듯한 상태로 일하고 있어.',
        },
      ],
    };
  }

  function mount({ container, englishEl, getContext, getVideo, request }) {
    const host = document.createElement('div');
    host.id = 'dual-sub-study';
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1000000;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host{font:14px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e9edf6;text-align:left;}
      *{box-sizing:border-box} [hidden]{display:none!important}
      .panel{pointer-events:auto;position:absolute;right:18px;top:18px;width:min(432px,calc(100% - 36px));max-height:calc(100% - 36px);overflow:auto;background:#111722;border:1px solid #394354;border-radius:16px;box-shadow:0 14px 60px #0009;overscroll-behavior:contain;}
      .head{position:sticky;top:0;background:#111722;z-index:1;padding:15px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #293240;gap:8px}
      .head strong{font-size:16px}.tag{color:#aeb9ca;font-size:11px;margin-top:2px}.body{padding:16px 18px 20px}
      button{font:inherit;cursor:pointer;border:1px solid #4b5870;border-radius:8px;color:#e9edf6;background:#263247;padding:6px 11px;line-height:1.4}
      button:focus-visible,.panel:focus-visible{outline:2px solid #b8a3ff;outline-offset:3px}button:disabled{opacity:.55;cursor:wait}
      .close{background:transparent;font-size:12px;padding:5px 9px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}.primary{background:#d1c3ff;color:#1b1630;border-color:#d1c3ff;font-weight:650}
      blockquote{padding:11px 13px;background:#1c2533;border-radius:9px;margin:0 0 15px;border:1px solid #303e52;white-space:pre-wrap}.en{color:#ffe08a;font-size:15px;font-weight:600}.ko{color:#c5cfdf;font-size:13px;margin-top:5px}
      h3{font-size:12px;color:#b6c1d3;margin:18px 0 6px}p{margin:0 0 8px;overflow-wrap:anywhere}.summary{font-size:15px;color:#f0f2f8}.note{color:#b6c1d3;font-size:12px}
      .card{padding:14px 0;border-top:1px solid #303a49}.phrase{display:block;font-weight:700;font-size:17px;color:#ffe08a;margin-bottom:4px}.meaning{color:#f4f6fa;font-weight:600;margin:0 0 8px}
      .reason{border-left:2px solid #a793ef;padding-left:10px;font-size:13px;color:#bdc8da}.example{margin-top:10px;padding:10px;background:#1c2533;border-radius:8px;font-size:13px}.example .ko{font-size:12px}
      .status{color:#c6d0e2;font-size:13px}.footer{border-top:1px solid #303a49;padding-top:12px;margin-top:12px;font-size:11px;color:#a4afc0}
      @media(max-height:500px){.panel{top:8px;max-height:calc(100% - 16px)}.head{padding:8px 14px}.body{padding:10px 14px}}
    `;
    shadow.append(style);
    const panel = document.createElement('section');
    panel.className = 'panel'; panel.hidden = true; panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '영어 표현 해설');
    shadow.append(panel);
    container.append(host);
    let generation = 0;
    let disposed = false;
    let openContext = null;
    let opener = null;

    function node(tag, text, className, parent) {
      const el = document.createElement(tag);
      if (text) el.textContent = text;
      if (className) el.className = className;
      if (parent) parent.append(el);
      return el;
    }
    function close() {
      generation++;
      panel.hidden = true;
      openContext = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      // Closing never starts playback. Only the explicit play button does.
    }
    function renderExplanation(explanation, target) {
      target.replaceChildren();
      node('p', explanation.summary, 'summary', target);
      node('h3', '왜 이렇게 번역했을까?', '', target);
      node('p', explanation.translationNote, '', target);
      let phrases = explanation.phrases || [];
      if (openContext?.selection) {
        const selected = normalize(openContext.selection);
        phrases = [...phrases].sort((a, b) => Number(normalize(b.expression).includes(selected)) - Number(normalize(a.expression).includes(selected)));
      }
      for (const phrase of phrases) {
        const card = node('article', '', 'card', target);
        node('span', phrase.expression, 'phrase', card);
        node('p', phrase.meaning, 'meaning', card);
        node('p', phrase.breakdown, '', card);
        if (phrase.translationNote) node('p', phrase.translationNote, 'reason', card);
        const ex = node('div', '', 'example', card);
        node('div', phrase.exampleEn, '', ex);
        node('div', phrase.exampleKo, 'ko', ex);
      }
    }
    async function open(selection = '', source = null) {
      if (disposed) return;
      const context = getContext(selection);
      if (!context?.english) return;
      const token = ++generation;
      openContext = context; opener = source || englishEl;
      const video = getVideo();
      if (video && !video.paused) video.pause();
      panel.replaceChildren(); panel.hidden = false;
      const head = node('div', '', 'head', panel);
      const title = node('div', '', '', head);
      node('strong', '표현을 이해하는 자막', '', title);
      const sourceTag = node('div', '요청한 문장만 해설', 'tag', title);
      const headButtons = node('div', '', 'actions', head); headButtons.style.margin = '0';
      const play = node('button', '이어서 보기', 'close', headButtons);
      play.addEventListener('click', () => { close(); const currentVideo = getVideo(); if (currentVideo) currentVideo.play().catch(() => {}); });
      const dismiss = node('button', '닫기', 'close', headButtons);
      dismiss.addEventListener('click', close);
      const body = node('div', '', 'body', panel);
      const quote = node('blockquote', '', '', body);
      node('div', context.english, 'en', quote);
      node('div', context.korean || '겹치는 한국어 자막이 없어 영어 문맥만 설명해요.', 'ko', quote);
      if (context.selection) node('p', `선택한 표현: ${context.selection}`, 'note', body);
      const result = node('div', '', '', body); result.setAttribute('aria-live', 'polite');
      const local = localExplanation(context);
      if (local) {
        sourceTag.textContent = '내장 예문 해설 · 이 문장 전용';
        renderExplanation(local, result);
      }
      const status = node('p', local ? '다른 대사의 문맥 해설은 AI를 연결하면 사용할 수 있어요.' : 'AI를 연결하면 표현의 뜻과 자막 번역의 이유를 함께 설명해요.', 'status', body);
      const actions = node('div', '', 'actions', body);
      const explain = node('button', local ? 'AI로 다시 해설' : 'AI로 이 문장 해설', 'primary', actions);
      explain.hidden = true;
      const setup = node('button', 'AI 연결 설정', '', actions);
      setup.addEventListener('click', async () => {
        try { const response = await request({ type: 'STUDY_OPEN_SETTINGS' }); if (!response?.ok) status.textContent = response?.message || '확장 프로그램 팝업에서 AI 연결 설정을 열어주세요.'; }
        catch { status.textContent = '확장 프로그램을 다시 불러온 뒤 AI 연결 설정을 열어주세요.'; }
      });
      node('p', 'AI 요청 시 현재 영·한 자막과 선택한 표현을 Gemini로 보내요. 앞뒤 영어 자막 각 1개는 설정에서 선택한 경우에만 포함해요. 영상·음성·시청 URL은 보내지 않아요. 제공자 요금이 발생할 수 있어요.', 'footer', body);
      explain.addEventListener('click', async () => {
        if (explain.disabled) return;
        explain.disabled = true; status.textContent = '표현과 번역 이유를 살펴보고 있어요…';
        try {
          const answer = await request({ type: 'STUDY_EXPLAIN', payload: context });
          if (disposed || token !== generation) return;
          if (!answer?.ok) { status.textContent = answer?.message || '해설을 가져오지 못했어요. 잠시 뒤 다시 시도해주세요.'; return; }
          renderExplanation(answer.explanation, result);
          sourceTag.textContent = 'Gemini AI 해설 · 문맥에 따라 틀릴 수 있어요';
          status.textContent = '이 문장의 해설이에요. 새 문장은 자막에서 다시 열어주세요.';
        } catch { if (token === generation) status.textContent = '확장 프로그램 연결을 확인한 뒤 다시 시도해주세요.'; }
        finally { if (token === generation) explain.disabled = false; }
      });
      panel.focus({ preventScroll: true });
      try {
        const config = await request({ type: 'STUDY_STATUS' });
        if (disposed || token !== generation) return;
        explain.hidden = !config?.configured;
        if (!config?.configured && !local) status.textContent = '아직 AI가 연결되지 않았어요. API 키를 연결한 뒤 이 문장만 요청할 수 있어요.';
        if (config?.configured && !local) status.textContent = '버튼을 누를 때만 이 문장의 해설을 요청해요.';
      } catch { if (token === generation && !local) status.textContent = 'AI 미연결 상태예요. 확장 프로그램 팝업에서 연결해주세요.'; }
    }
    for (const type of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'wheel']) panel.addEventListener(type, (event) => event.stopPropagation());
    panel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const focusable = [...panel.querySelectorAll('button:not([hidden]):not(:disabled)')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (shadow.activeElement === first || shadow.activeElement === panel)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    const oldStyles = { pointerEvents: englishEl.style.pointerEvents, cursor: englishEl.style.cursor, userSelect: englishEl.style.userSelect };
    const oldAttrs = new Map(['role', 'tabindex', 'title', 'aria-label'].map((name) => [name, englishEl.getAttribute(name)]));
    englishEl.style.pointerEvents = 'auto'; englishEl.style.cursor = 'help'; englishEl.style.userSelect = 'text';
    englishEl.setAttribute('role', 'button'); englishEl.tabIndex = 0;
    englishEl.title = '클릭하면 문장 해설 · 드래그하면 선택한 표현 해설';
    englishEl.setAttribute('aria-label', '현재 영어 자막 표현 해설');
    const onClick = (event) => {
      event.preventDefault(); event.stopPropagation();
      const selection = window.getSelection();
      const text = selection && englishEl.contains(selection.anchorNode) && englishEl.contains(selection.focusNode) ? selection.toString() : '';
      open(text, englishEl);
    };
    const onKey = (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); open('', englishEl); } };
    const stopPointer = (event) => event.stopPropagation();
    englishEl.addEventListener('click', onClick);
    englishEl.addEventListener('keydown', onKey);
    englishEl.addEventListener('pointerdown', stopPointer);
    englishEl.addEventListener('mousedown', stopPointer);
    return {
      open, close,
      destroy() {
        disposed = true; close(); host.remove();
        englishEl.removeEventListener('click', onClick); englishEl.removeEventListener('keydown', onKey);
        englishEl.removeEventListener('pointerdown', stopPointer); englishEl.removeEventListener('mousedown', stopPointer);
        Object.assign(englishEl.style, oldStyles);
        for (const [key, value] of oldAttrs) { if (value === null) englishEl.removeAttribute(key); else englishEl.setAttribute(key, value); }
      },
    };
  }
  const api = { buildContext, localExplanation, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OTTDualSubsStudy = api;
})(globalThis);
