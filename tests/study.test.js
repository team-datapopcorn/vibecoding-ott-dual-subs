const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContext, localExplanation } = require('../ott-dual-subs-v2/study.js');
const en = [{startTime:0,endTime:1,text:'Before.'},{startTime:1,endTime:3,text:'The actionable intel comes\nwith a tight clock,'},{startTime:3,endTime:4,text:'After.'}];
const ko = [{startTime:0,endTime:1,text:'앞 대사'},{startTime:1,endTime:2,text:'정보를 입수했는데'},{startTime:2,endTime:3.5,text:'시간이 촉박해'},{startTime:4,endTime:5,text:'다른 대사'}];
test('gathers current line, overlapping Korean cues, one adjacent English cue each',()=>{
  assert.deepEqual(buildContext(en,ko,1.5),{english:'The actionable intel comes with a tight clock,',korean:'정보를 입수했는데 시간이 촉박해',previous:'Before.',next:'After.',selection:''});
});
test('does not select an expired cue or reuse prior sentence in gaps',()=>{
  assert.equal(buildContext(en,ko,5),null);
  assert.equal(buildContext([],ko,1),null);
  assert.equal(buildContext(en,ko,3).english,'After.');
});
test('only accepts a selection from the current English line',()=>{
  assert.equal(buildContext(en,ko,2,'actionable intel').selection,'actionable intel');
  assert.equal(buildContext(en,ko,2,'not in this cue').selection,'');
});
test('bounds all context lengths',()=>{
  const context=buildContext([{startTime:0,endTime:1,text:'x'.repeat(3000)}],[{startTime:0,endTime:1,text:'가'.repeat(3000)}],0.5,'x'.repeat(500));
  assert.equal(context.english.length,800);assert.equal(context.korean.length,800);assert.equal(context.selection.length,240);
});
test('built-in review is only for the precise example, never a generic AI substitute',()=>{
  const result=localExplanation(buildContext(en,ko,2));
  assert.equal(result.phrases.length,3);
  assert.match(result.phrases[0].breakdown,/intelligence/);
  for(const phrase of result.phrases){assert.ok(phrase.exampleEn);assert.ok(phrase.exampleKo);}
  assert.equal(localExplanation({english:'The actionable intel was wrong.'}),null);
  assert.equal(localExplanation({english:'a tight clock'}),null);
  assert.equal(localExplanation({english:''}),null);
});
test('accepts the real VTT parser output rather than invented cue time fields',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ott-dual-subs-v2/vtt-parser.js'),'utf8'),sandbox);
  const cues=sandbox.parseVTT('WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nThe actionable intel comes with a tight clock,\n');
  assert.equal(buildContext(cues,[],1).english,'The actionable intel comes with a tight clock,');
});
