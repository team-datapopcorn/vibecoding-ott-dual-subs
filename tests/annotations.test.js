const test=require('node:test');const assert=require('node:assert/strict');
const {localAnnotations,toAnnotations,contextKey,computePlacement}=require('../ott-dual-subs-v2/annotations.js');
test('example annotations are short, contextual, and never used for unrelated lines',()=>{
 const notes=localAnnotations({english:'The actionable intel comes\nwith a tight clock,'});
 assert.equal(notes.length,2);assert.equal(notes[0].expression,'actionable intel');assert.equal(notes[1].meaning,'빠듯한 제한 시간');
 assert.equal(localAnnotations({english:'intel'}).length,0);assert.equal(localAnnotations(null).length,0);
 for(const n of notes)assert.ok(n.note.length<75);
});
test('only expressions occurring in the actual subtitle become notes',()=>{
 const notes=toAnnotations({phrases:[{expression:'not in line',meaning:'x',breakdown:'y'},{expression:'run into',meaning:'우연히 만나다',annotation:'run + into: 우연히 마주치다'},{expression:'a friend',meaning:'친구',breakdown:'x'},{expression:'friend',meaning:'친구',breakdown:'y'}]},'We run into a friend.');
 assert.equal(notes.length,2);assert.equal(notes[0].expression,'run into');assert.equal(notes[0].note,'run + into: 우연히 마주치다');
});
test('cache key includes translation and neighboring context',()=>{
 assert.notEqual(contextKey({english:'same',korean:'A'}),contextKey({english:'same',korean:'B'}));
 assert.notEqual(contextKey({english:'same',previous:'A'}),contextKey({english:'same',previous:'B'}));assert.equal(contextKey(null),'');
});
test('places two notes left and right without covering either subtitle',()=>{
 const p=computePlacement({width:1100,height:974,anchor:{left:322,right:778,top:718,bottom:857},english:{bottom:713},noteHeights:[116,116],pictureBottom:795});
 assert.equal(p.mode,'sides');assert.ok(p.slots[0].x+p.slots[0].width<322);assert.ok(p.slots[1].x>778);
 for(const s of p.slots){assert.ok(s.y>=805);assert.ok(s.y+116<=930);}
});
test('narrow or crowded layouts fall back instead of colliding with subtitles',()=>{
 assert.equal(computePlacement({width:360,height:400,anchor:{left:30,right:330,top:200,bottom:320},english:{bottom:196},noteHeights:[100,100]}).mode,'fallback');
 assert.equal(computePlacement({width:240,height:150,anchor:{left:60,right:180,top:40,bottom:80},english:{bottom:38},noteHeights:[100]}).mode,'hidden');
});
test('single note uses the available right margin when the left margin is full',()=>{
 const p=computePlacement({width:1000,height:600,anchor:{left:50,right:600,top:350,bottom:400},english:{bottom:300},noteHeights:[80]});assert.equal(p.mode,'sides');assert.equal(p.slots[0].side,1);
});
test('parser does not keep the old subtitle on an exact cue boundary',()=>{
 const vm=require('node:vm'),fs=require('node:fs');const box={};vm.createContext(box);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../ott-dual-subs-v2/vtt-parser.js'),'utf8'),box);
 assert.equal(box.findActiveCue([{startTime:0,endTime:1,text:'old'},{startTime:1,endTime:2,text:'new'}],1).text,'new');
});
