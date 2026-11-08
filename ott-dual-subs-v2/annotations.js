/* Synchronized margin annotations. No playback controls, focus, or media capture. */
(function (root) {
  'use strict';
  const compact = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const normalize = (text) => compact(text, 800).toLowerCase().replace(/[.,!?;:]+$/g, '');
  const exampleNotes = [
    {
      english: 'The actionable intel comes with a tight clock,',
      notes: [
        { expression: 'actionable intel', meaning: '행동에 옮길 수 있는 첩보', note: 'intel = 정보·첩보 / actionable = 실행 가능한' },
        { expression: 'a tight clock', meaning: '빠듯한 제한 시간', note: 'tight = 여유 없는 / clock = 남은 시간' },
      ],
    },
    {
      english: 'and for the last three years has been leading a paramilitary offshoot of AKM.',
      notes: [
        { expression: 'paramilitary offshoot', meaning: '준군사 조직의 분파', note: 'offshoot: 나뭇가지에서 → 갈라져 나온 조직' },
        { expression: 'has been leading', meaning: '지금까지 계속 이끌어 왔다', note: 'has been + -ing: 과거부터 현재까지 이어짐' },
      ],
    },
  ];
  function localAnnotations(context) {
    const match = exampleNotes.find((item) => normalize(item.english) === normalize(context?.english));
    return match ? match.notes.map((note) => ({ ...note })) : [];
  }
  function toAnnotations(explanation, english = '') {
    const line = normalize(english);
    return (explanation?.phrases || [])
      .filter((phrase) => phrase && typeof phrase.expression === 'string' && line.includes(normalize(phrase.expression)))
      .slice(0, 2)
      .map((phrase) => ({
        expression: compact(phrase.expression, 64),
        meaning: compact(phrase.meaning, 48),
        note: compact(phrase.annotation || phrase.breakdown, 75),
      }));
  }
  function contextKey(context) {
    if (!context?.english) return '';
    return JSON.stringify([context.english, context.korean || '', context.previous || '', context.next || '']);
  }
  // All numbers are player-relative CSS pixels. Use actual subtitle bounds, not guessed font widths.
  function computePlacement({ width, height, anchor, english, noteHeights, pictureBottom, controlReserve = 36 }) {
    const edge = 18, gap = 16, minWidth = 142, maxWidth = 228;
    if (!anchor || width < 260 || height < 180) return { mode: 'hidden', slots: [] };
    // When both subtitles leave side margins, notes may sit beside English too.
    const unionLeft = Number.isFinite(english?.left) ? Math.min(anchor.left, english.left) : anchor.left;
    const unionRight = Number.isFinite(english?.right) ? Math.max(anchor.right, english.right) : anchor.right;
    const useUnion = Number.isFinite(english?.left) && Number.isFinite(english?.right) && unionLeft-edge-gap>=minWidth && width-unionRight-edge-gap>=minWidth;
    const availableLeft = (useUnion ? unionLeft : anchor.left) - edge - gap;
    const availableRight = width - (useUnion ? unionRight : anchor.right) - edge - gap;
    const sideWidths = [Math.min(maxWidth, availableLeft), Math.min(maxWidth, availableRight)];
    const maxHeight = Math.max(...noteHeights, 0);
    let top = useUnion ? anchor.top + 2 : Math.max(anchor.top + 2, english?.bottom + 8 || 0);
    // Prefer a real letterbox bar if one exists. This is geometry, not darkness recognition.
    if (Number.isFinite(pictureBottom) && height - pictureBottom >= maxHeight + controlReserve + 10) top = Math.max(top, pictureBottom + 10);
    top = Math.min(top, height - maxHeight - controlReserve);
    const slots = [];
    for (let i = 0; i < noteHeights.length; i++) {
      const side = i === 0 && sideWidths[0] >= minWidth ? 0 : 1;
      if (sideWidths[side] < minWidth || (i > 0 && slots.some((slot) => slot.side === side))) return { mode: 'fallback', slots: [] };
      const x = side === 0 ? edge : width - edge - sideWidths[side];
      if (!useUnion && top < (english?.bottom || 0) + 8) return { mode: 'fallback', slots: [] };
      slots.push({ side, x, y: top, width: sideWidths[side] });
    }
    return { mode: 'sides', slots };
  }
  function mount({ container, englishEl, koreanEl, getVideo, request, getSettings = () => ({ inlineNotes: true }) }) {
    const host = document.createElement('div'); host.id = 'dual-sub-annotations';
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:999998;overflow:hidden;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e7e9ef;text-align:left}*{box-sizing:border-box}[hidden]{display:none!important}.note{position:absolute;max-width:228px;padding:9px 11px;border-left:2px solid #b0a4cb;background:linear-gradient(90deg,#101116aa,#10111630);border-radius:0 5px 5px 0;text-shadow:0 1px 3px #000;line-height:1.45;pointer-events:none}.expression{font-size:13px;color:#e5d3ff;font-weight:600;overflow-wrap:anywhere}.meaning{font-size:13px;color:#f3f3f5;margin-top:3px;overflow-wrap:anywhere}.detail{font-size:11px;color:#bcc2ce;margin-top:4px;overflow-wrap:anywhere}.badge{display:none}`;
    shadow.append(style); container.append(host);
    let disposed = false, currentKey = '', context = null, generation = 0, wanted = [], cards = [];
    const pending = new Map();
    let lastSource = '';
    function clear() { for (const card of cards) card.remove(); cards = []; wanted = []; }
    function place() {
      if (disposed || !cards.length) return;
      if (getSettings().inlineNotes === false || !englishEl.textContent.trim() || !container.isConnected) { for (const card of cards) card.hidden = true; return; }
      const rect = container.getBoundingClientRect();
      const relative = (element) => { const r = element.getBoundingClientRect();return { left:r.left-rect.left, right:r.right-rect.left, top:r.top-rect.top, bottom:r.bottom-rect.top }; };
      const english = relative(englishEl), korean = koreanEl?.textContent.trim() ? relative(koreanEl) : null;
      const video = getVideo?.();
      let pictureBottom;
      if (video?.videoWidth && video?.videoHeight && ['contain', 'scale-down'].includes(getComputedStyle(video).objectFit)) {
        const vr = video.getBoundingClientRect();
        const scale = Math.min(vr.width / video.videoWidth, vr.height / video.videoHeight);
        pictureBottom = vr.top - rect.top + (vr.height + video.videoHeight * scale) / 2;
      }
      const anchor = korean || english;
      const heights = cards.map(card => { card.hidden=false;card.style.maxWidth='228px';card.querySelector('.detail').hidden=false;card.querySelector('.badge').hidden=false;card.style.width='228px';return card.getBoundingClientRect().height; });
      let placement = computePlacement({ width:rect.width,height:rect.height,anchor,english,noteHeights:heights,pictureBottom,controlReserve:video?.paused ? 180 : 36 });
      if (placement.mode === 'sides') {
        cards.forEach((card,i)=>{const slot=placement.slots[i];card.style.width=slot.width+'px';});
        placement = computePlacement({ width:rect.width,height:rect.height,anchor,english,noteHeights:cards.map(card=>card.getBoundingClientRect().height),pictureBottom,controlReserve:video?.paused ? 180 : 36 });
      }
      if (placement.mode === 'sides') cards.forEach((card,i)=>{const slot=placement.slots[i];card.style.left=slot.x+'px';card.style.top=slot.y+'px';card.hidden=false;card.dataset.placement='side';});
      else {
        // Narrow players: one compact footnote below subtitles only if it fits. Never cover the dialogue.
        const card = cards[0], note = wanted[0];
        card.style.width=Math.min(320,rect.width-36)+'px';card.style.maxWidth='320px';
        card.querySelector('.detail').hidden=true;card.querySelector('.badge').hidden=true;
        const y=Math.max(anchor.bottom,english.bottom)+8;
        card.style.left=Math.max(18,(rect.width-Math.min(320,rect.width-36))/2)+'px';card.style.top=y+'px';
        card.hidden=y+card.getBoundingClientRect().height>rect.height-(video?.paused ? 180 : 34);card.dataset.placement='below';
        for(const other of cards.slice(1))other.hidden=true;
      }
    }
    function render(notes, source) {
      clear();wanted=notes.slice(0,2);lastSource=source;
      for(const item of wanted){
        const card=document.createElement('aside');card.className='note';card.setAttribute('aria-label','영어 표현 주석');
        for(const [cls,text] of [['expression',item.expression],['meaning',item.meaning],['detail',item.note],['badge',source==='gemini'?'AI 주석':'사전 재사용']]){
          const part=document.createElement('div');part.className=cls;part.textContent=text;card.append(part);
        }
        shadow.append(card);cards.push(card);
      }
      place();
    }
    async function update(nextContext) {
      const depth = ['strong','medium','weak'].includes(getSettings().annotationDepth) ? getSettings().annotationDepth : 'medium';
      const cueKey = contextKey(nextContext);
      const key = cueKey ? depth + ':' + cueKey : '';
      if (disposed) return;
      if (!key || getSettings().inlineNotes === false) { currentKey='';context=null;generation++;clear();return; }
      if(key===currentKey){place();return;}
      currentKey=key;context={...nextContext};const token=++generation;clear();
      try {
        // Persistent dictionary always precedes status checks or a provider request.
        const lookup=await request({type:'STUDY_DICTIONARY_LOOKUP',payload:context});
        if(disposed||token!==generation)return;
        if(lookup?.ok){
          if(lookup.notes?.length){render(lookup.notes,'dictionary');return;}
          if(!lookup.eligible)return;
        } else {
          // Content-only preview can still use the same reviewed local dictionary and depth rules.
          const api=globalThis.OTTDualSubsDictionary;
          const plan=api?.planGeneration(api.BUILTIN_ENTRIES || api.builtinEntries || [], context, depth);
          if(plan?.reused?.length){render(plan.reused.map(e=>({expression:e.matchedExpression||e.expression,meaning:e.meaning,note:e.note})),'dictionary');return;}
          // A real storage error is not permission to charge for regenerating a saved expression.
          return;
        }
        const status=await request({type:'STUDY_STATUS'});
        if(disposed||token!==generation||!status?.configured||status.inlineAI!==true)return;
        if(!pending.has(key)) pending.set(key,request({type:'STUDY_EXPLAIN',payload:context}));
        const answer=await pending.get(key);pending.delete(key);
        if(answer?.ok){
          const notes=answer.notes || toAnnotations(answer.explanation,nextContext.english);
          if(!disposed&&token===generation&&currentKey===key&&notes.length)render(notes,answer.source==='dictionary'?'dictionary':'gemini');
        }
      }catch{pending.delete(key);}
    }
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    resize?.observe(container);resize?.observe(englishEl);if(koreanEl)resize?.observe(koreanEl);
    const observedVideo=getVideo?.();
    observedVideo?.addEventListener?.('pause',place);observedVideo?.addEventListener?.('play',place);
    const onResize=()=>place();window.addEventListener('resize',onResize);document.addEventListener('fullscreenchange',onResize);
    return {update,layout:place,clear(){currentKey='';context=null;generation++;clear();},destroy(){disposed=true;generation++;clear();resize?.disconnect();observedVideo?.removeEventListener?.('pause',place);observedVideo?.removeEventListener?.('play',place);window.removeEventListener('resize',onResize);document.removeEventListener('fullscreenchange',onResize);host.remove();}};
  }
  const api={localAnnotations,toAnnotations,contextKey,computePlacement,mount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.OTTDualSubsAnnotations=api;
})(globalThis);
