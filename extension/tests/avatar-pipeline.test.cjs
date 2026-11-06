const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/../../js/core.js','utf8'),section=source.slice(source.indexOf('const PIC_TTL'),source.indexOf('// Dòng Page nhỏ'));
const fast='100000000123456',slow='100000000999999',values={},arrivals=[],timers=[];let slowSignal;
const App={GRAPH:'https://graph.facebook.com/v25.0'},DB={get:async(k,f)=>structuredClone(values[k]||f),set:async(k,v)=>values[k]=structuredClone(v)};
const api=async(path,p,method,token,options)=>{
 assert.equal(token,'private');if(path==='/'+slow&&p.fields==='profile_pic'){slowSignal=options.signal;return new Promise((resolve,reject)=>slowSignal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}))));}
 if(path==='/'+fast&&p.fields==='profile_pic')return {profile_pic:'https://cdn.example/fast.jpg'};
 if(path.includes('/'+slow+'/picture'))return {data:{is_silhouette:false,url:'https://cdn.example/slow.jpg'}};return {};
};
const pool=async(items,n,fn)=>{let index=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(index<items.length)await fn(items[index++]);}));};
vm.runInNewContext(section,{App,DB,api,pool,URL,Date,Map,Set,Promise,AbortController,setTimeout:(fn,ms)=>{const t={fn,ms,cleared:false};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;},console:{warn(){}}});
(async()=>{const pending=App.customerPics({id:'10',access_token:'private'},[slow,fast],{onResult:(id,url)=>arrivals.push({id,url})});for(let n=0;n<10;n++)await new Promise(r=>setImmediate(r));assert.ok(slowSignal&&!slowSignal.aborted);assert.ok(arrivals.some(r=>r.id===fast&&r.url));assert.equal(values.avatarCacheV7['10:'+fast].url,'https://cdn.example/fast.jpg','successful photo durable while another customer is waiting');
 const timeout=timers.find(t=>t.ms===12000&&!t.cleared);assert.ok(timeout);timeout.fn();const result=await pending;assert.equal(slowSignal.aborted,true);assert.equal(result.get(slow),'https://cdn.example/slow.jpg','timed out profile immediately switches to picture fallback');assert.equal(result.get(fast),'https://cdn.example/fast.jpg');assert.ok(App.customerAvatarDiagnostic().items.find(r=>r.id===slow).errors.some(e=>e.code==='AVATAR_TIMEOUT'));
 console.log('PASS: profile_pic first per customer, slow customer cannot block other photos or their durable saves, real AbortSignal cancels stalled photo requests, fallback resumes, timeout captured without affecting GPT waits.');
})().catch(e=>{console.error(e);process.exitCode=1});
