const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
test('closing a tab does not reject when Chrome refuses a badge write for the removed tab',async()=>{
 let removed;let writes=0;const noTab=async()=>{writes++;throw Error('No tab with id: 42.');};
 const chrome={storage:{session:{async get(){return{}},async set(){},async remove(){}}},action:{setBadgeText:noTab,setBadgeBackgroundColor:noTab},tabs:{onRemoved:{addListener(fn){removed=fn}},onUpdated:{addListener(){}},async sendMessage(){}},webRequest:{onCompleted:{addListener(){}}},runtime:{onMessage:{addListener(){}}}};
 const box={chrome,console,setTimeout,importScripts(){}};vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ott-dual-subs-v2/background.js'),'utf8'),box);
 removed(42);await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);
});
test('simultaneous English/Korean subtitle completion preserves both sources',async()=>{
 const listeners=[],values=new Map();const chrome={storage:{session:{async get(k){return{[k]:JSON.parse(JSON.stringify(values.get(k)||[]))}},async set(v){for(const[k,x]of Object.entries(v))values.set(k,x)},async remove(k){values.delete(k)}}},action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},async sendMessage(){}},webRequest:{onCompleted:{addListener(fn){listeners.push(fn)}}},runtime:{onMessage:{addListener(){}}}};
 const box={chrome,console:{log(){},warn(){},error(){}},setTimeout,importScripts(){}};vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ott-dual-subs-v2/background.js'),'utf8'),box);
 await Promise.all([listeners[0]({tabId:7,url:'https://cdn.coupangstreaming.com/subtitle/en.vtt'}),listeners[0]({tabId:7,url:'https://cdn.coupangstreaming.com/subtitle/ko.vtt'})]);assert.equal(values.get('subs_7').length,2);
});
