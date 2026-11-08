/* Test-only Chrome API stand-in. No credentials and no external requests. */
(()=>{
 const local=new Map(),session=new Map();
 const area=map=>({async get(key){return Array.isArray(key)?Object.fromEntries(key.map(k=>[k,map.get(k)])):{[key]:map.get(key)}},async set(values){for(const[k,v]of Object.entries(values))map.set(k,v)},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])map.delete(key)}});
 const id='abcdefghijklmnopabcdefghijklmnop';window.testMessages=[];window.testAreas={local,session};
 window.chrome={runtime:{id,onMessage:{addListener(){}},sendMessage(message,cb){testMessages.push(message.type);Promise.resolve().then(()=>OTTDualSubsStudyAI.handleMessage(message,{id,url:'chrome-extension://'+id+'/study-options.html'})).then(cb)},async openOptionsPage(){}},storage:{local:area(local),session:{...area(session),async setAccessLevel(){}}},permissions:{async contains(){return false},async request(){throw Error('No real permissions in fixture')}}};
})();
