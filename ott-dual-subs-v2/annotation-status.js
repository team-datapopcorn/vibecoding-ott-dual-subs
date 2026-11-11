/* Pure status presentation. No requests, credential access, or playback controls. */
(function(root){
 'use strict';
 const depthName=value=>({strong:'강',medium:'중',weak:'약'}[value]||'중');
 const errors={AUTH_ERROR:'API 키·권한 오류',QUOTA_ERROR:'할당량·요금 확인',MODEL_NOT_FOUND:'모델 ID 확인',REQUEST_REJECTED:'API 요청 형식 확인',TIMEOUT:'AI 응답 지연',INVALID_RESPONSE:'AI 응답 형식 오류',PROVIDER_ERROR:'AI 통신 오류',CONFIG_MISSING:'API 키 필요',PERMISSION_REQUIRED:'API 권한 필요',DICTIONARY_ERROR:'사전 읽기 오류',DICTIONARY_UNAVAILABLE:'사전 연결 확인',CONFIG_CHANGED:'설정 변경됨',UNSUPPORTED_SENDER:'확장 연결 확인',RUNTIME_ERROR:'확장 새로고침 필요'};
 function describe(config,activity={code:'idle'},depth='medium',metrics={}){
  const d=config?.diagnostics||{},code=activity.code||'idle';
  let connection='설정 확인 중',tone='neutral';
  if(config){
   if(config.ok===false){connection='확장 연결 확인';tone='error';}
   else if(!config.configured){connection='API 미설정';tone='off';}
   else if(config.permissionGranted===false){connection='API 권한 필요';tone='error';}
   else if(!config.inlineAI){connection='AI 자동 생성 꺼짐';tone='off';}
   else if(d.lastOutcome==='error'){connection=errors[d.lastErrorCode]||'AI 오류';tone='error';}
   else if(d.lastSuccessAt){connection='AI 응답 확인';tone='success';}
   else {connection='AI 설정됨';tone='ready';}
  }
  let action={idle:'대기',checking:'사전 확인',dictionary:'사전 재사용',filtered:'선별 제외',requesting:'AI 생성 중…',generated:'새 AI 주석',cache:'생성 결과 재사용',gap:'자막 대기',tracks:'자막 준비',disabled:'주석 꺼짐',busy:'다른 대사 생성 중',missing:'API 키 필요',off:'자동 생성 꺼짐',hidden:'주석 여백 부족',empty:'표시할 표현 없음',error:errors[activity.errorCode]||'오류 확인'}[code]||'대기';
  if(code==='tracks')action+=' '+Math.min(2,activity.count||0)+'/2';
  if(code==='dictionary'&&activity.count)action+=' '+activity.count+'개';

  if(code==='requesting'||(code==='busy'&&d.inFlight>0))tone='loading';
  if(code==='error')tone='error';
  const lines=[connection+' · 깊이 '+depthName(depth),action];
  if(config?.configured&&!d.lastSuccessAt)lines.push('API 키 등록은 확인했지만, 실제 AI 응답 성공은 아직 확인되지 않았습니다.');
  if(d.attempts!==undefined)lines.push('현재 서비스 워커: 실제 요청 '+d.attempts+' · 성공 '+(d.successes||0)+' · 실패 '+(d.failures||0));
  if(metrics.dictionaryHits!==undefined)lines.push('이 화면 사전 재사용 '+metrics.dictionaryHits+'회 (이용권 잔여 횟수 아님)');
  if(d.lastHttpStatus)lines.push('최근 HTTP '+d.lastHttpStatus);
  if(d.lastDurationMs)lines.push('최근 응답 '+(d.lastDurationMs/1000).toFixed(1)+'초');
  if(activity.detail)lines.push(String(activity.detail).slice(0,180));
  lines.push('클릭하면 표현 사전·AI 설정을 엽니다. 상태 조회 자체는 AI 요청을 하지 않습니다.');
  return {connection,activity:action,depth:depthName(depth),tone,title:lines.join('\n')};
 }
 function mountIndicator(shadow,onSettings){
  const style=document.createElement('style');style.textContent=`.ott-status{position:absolute;left:18px;top:58px;max-width:calc(100% - 36px);z-index:2;pointer-events:auto;border:1px solid #62667199;border-radius:15px;background:#11151cd9;color:#dce1ec;font:11px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:5px 9px;display:flex;align-items:center;gap:6px;cursor:pointer;text-align:left;box-shadow:0 1px 8px #0003}.ott-status:focus-visible{outline:2px solid #c2b5f3;outline-offset:3px}.ott-status .dot{width:6px;height:6px;flex:none;border-radius:50%;background:#939aa8}.ott-status[data-tone="ready"] .dot{background:#d3b968}.ott-status[data-tone="success"] .dot{background:#91cda7}.ott-status[data-tone="error"] .dot{background:#e29c92}.ott-status[data-tone="loading"] .dot{background:#c5b7f3;animation:ott-status-pulse 1s ease-in-out infinite}.ott-status .separate{opacity:.35}.ott-status .activity{color:#b9c4d7}.ott-status .connection{white-space:nowrap}@keyframes ott-status-pulse{50%{opacity:.25}}@media(prefers-reduced-motion:reduce){.ott-status .dot{animation:none!important}}@media(max-width:520px){.ott-status{left:10px;top:46px;font-size:10px;gap:4px;padding:4px 7px;flex-wrap:wrap}}`;
  const button=document.createElement('button');button.type='button';button.className='ott-status';button.dataset.tone='neutral';button.setAttribute('aria-label','주석 상태와 AI 설정');
  const dot=document.createElement('span');dot.className='dot';dot.setAttribute('aria-hidden','true');
  const connection=document.createElement('span');connection.className='connection';
  const separator=document.createElement('span');separator.className='separate';separator.textContent='|';separator.setAttribute('aria-hidden','true');
  const activity=document.createElement('span');activity.className='activity';
  button.append(dot,connection,separator,activity);shadow.append(style,button);
  for(const type of ['pointerdown','mousedown','keydown'])button.addEventListener(type,event=>event.stopPropagation());
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onSettings?.();});
  return {render(state){connection.textContent=state.connection+' · '+state.depth;activity.textContent=state.activity;button.dataset.tone=state.tone;button.title=state.title;},destroy(){button.remove();style.remove();}};
 }
 const api={describe,mountIndicator,depthName};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.OTTDualSubsAnnotationStatus=api;
})(globalThis);
