const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWaitlistUrl, ottFromTabUrl, FORM_URL, LANGUAGES } = require('../ott-dual-subs-v2/pro-waitlist.js');
test('prefills the chosen language and the current OTT only',()=>{
  const url=new URL(buildWaitlistUrl('일본어','https://www.coupangplay.com/play/abc?titleId=1'));
  assert.equal(url.origin+url.pathname,FORM_URL);
  assert.equal(url.searchParams.get('usp'),'pp_url');
  assert.equal(url.searchParams.get('entry.1118344420'),'일본어');
  assert.equal(url.searchParams.get('entry.194440251'),'쿠팡플레이');
  assert.deepEqual([...url.searchParams.keys()].sort(),['entry.1118344420','entry.194440251','usp']);
});
test('drops unknown languages and unsupported or malformed tab URLs',()=>{
  const url=new URL(buildWaitlistUrl('클링온어','chrome://extensions'));
  assert.equal(url.searchParams.get('entry.1118344420'),null);
  assert.equal(url.searchParams.get('entry.194440251'),null);
  assert.equal(ottFromTabUrl('not a url'),'');
  assert.equal(ottFromTabUrl('https://evilnetflix.com/watch/1'),'');
  assert.equal(ottFromTabUrl('https://www.netflix.com/watch/1'),'넷플릭스');
});
test('language list matches the published form choices',()=>{
  assert.deepEqual(LANGUAGES,['일본어','중국어(간체)','중국어(번체)','스페인어','독일어','프랑스어','베트남어']);
});
