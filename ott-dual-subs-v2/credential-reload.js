/* One-shot, encrypted, extension-origin-only handoff across an unpacked reload.
 * Never returns a key. Removed after restore; expires in five minutes.
 */
(function(root,factory){const api=factory({crypto:root.crypto,indexedDB:root.indexedDB});if(typeof module!=='undefined'&&module.exports)module.exports={...api,createReloadKey:factory};else root.OTTDualSubsReloadKey=api;})(globalThis,function createReloadKey(env){
 'use strict';
 const API_KEY='studyGeminiApiKey',TTL=5*60*1000;
 const now=env.now||(()=>Date.now());
 function indexedStore(){
  let opened;
  function db(){if(!opened)opened=new Promise((resolve,reject)=>{const request=env.indexedDB.open('ott-dual-subs-update',1);request.onupgradeneeded=()=>request.result.createObjectStore('key-handoff');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('UPDATE_STORAGE_UNAVAILABLE'));});return opened;}
  async function transaction(mode,operation){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('key-handoff',mode),store=tx.objectStore('key-handoff');let result;const request=operation(store);request.onsuccess=()=>{result=request.result};request.onerror=()=>reject(new Error('UPDATE_STORAGE_UNAVAILABLE'));tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('UPDATE_STORAGE_UNAVAILABLE'));tx.onabort=()=>reject(new Error('UPDATE_STORAGE_UNAVAILABLE'));});}
  return{get:()=>transaction('readonly',s=>s.get('pending')),put:value=>transaction('readwrite',s=>s.put(value,'pending')),remove:()=>transaction('readwrite',s=>s.delete('pending'))};
 }
 const store=env.store||indexedStore();let restorePromise=null,checked=false;
 async function stage(session){
  const saved=await session.get(API_KEY);const value=saved?.[API_KEY];
  if(typeof value!=='string'||!value){await store.remove();return{staged:false,reason:'no-key'};}
  const key=await env.crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=env.crypto.getRandomValues(new Uint8Array(12));
  const cipher=await env.crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
  const expiresAt=now()+TTL,nonce=env.crypto.randomUUID();
  await session.set({studyReloadNonce:nonce});
  await store.put({key,iv,cipher,expiresAt,nonce});
  return{staged:true,encrypted:true,expiresAt};
 }
 async function restoreOnce(session){
  const record=await store.get();
  if(!record)return{restored:false,reason:'no-handoff'};
  if(!record.expiresAt||record.expiresAt<now()){await store.remove();return{restored:false,reason:'expired'};}
  const existing=await session.get([API_KEY,'studyReloadNonce']);
  if(record.nonce && existing?.studyReloadNonce===record.nonce)return{restored:false,reason:'await-reload'};
  if(existing?.[API_KEY]){await store.remove();return{restored:false,reason:'already-present'};}
  try{
   const plain=await env.crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv},record.key,record.cipher);
   const value=new TextDecoder().decode(plain);if(!value)throw Error('empty');
   await session.set({[API_KEY]:value});await store.remove();return{restored:true};
  }catch{throw new Error('UPDATE_KEY_RESTORE_FAILED');}
 }
 async function restore(session){
  if(checked)return{restored:false,reason:'checked'};
  if(!restorePromise)restorePromise=restoreOnce(session).then(result=>{checked=result.reason!=='await-reload';return result;}).finally(()=>{restorePromise=null});
  return restorePromise;
 }
 return{stage,restore,discard:()=>store.remove()};
});
