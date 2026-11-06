// Large jobs stay in IndexedDB; Chrome storage keeps small pointers and change events.
const StudioStorage=(()=>{
  const enabled=typeof indexedDB!=='undefined';let opening;
  function database(){return opening||=(new Promise((resolve,reject)=>{const r=indexedDB.open('meta-assistant-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}));}
  async function record(mode,key,value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('records',mode),store=tx.objectStore('records');const r=mode==='readonly'?store.get(key):value===undefined?store.delete(key):store.put(value,key);let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||r.error);tx.onabort=()=>reject(tx.error||Error('Không lưu được bản nháp.'));});}
  function area(name){const native=chrome.storage[name],large=new Set(name==='session'?['job']:['panelJob','pendingTransfer','reviewOutbox']);return {
    async get(keys){const values=await native.get(keys);if(enabled)for(const [key,value]of Object.entries(values)){if(large.has(key)&&value?.__metaStudioStore)values[key]=await record('readonly',value.__metaStudioStore);}return values;},
    async set(values){if(!enabled)return native.set(values);const pointers={...values};for(const [key,value]of Object.entries(values))if(large.has(key)&&value){const ref=(key==='job'||key==='panelJob')&&value.id?'job:'+value.id:name+':'+key;await record('readwrite',ref,value);pointers[key]={__metaStudioStore:ref,revision:Date.now()+Math.random()};}return native.set(pointers);},
    async remove(keys){const list=Array.isArray(keys)?keys:[keys];const previous=await native.get(list);await native.remove(keys);if(enabled)for(const [key,value]of Object.entries(previous))if(large.has(key)&&value?.__metaStudioStore&&key!=='job'&&key!=='panelJob')await record('readwrite',value.__metaStudioStore);}
  };}
  return {local:area('local'),session:area('session'),forgetJob:async id=>{if(enabled&&id)await record('readwrite','job:'+id);}};
})();
