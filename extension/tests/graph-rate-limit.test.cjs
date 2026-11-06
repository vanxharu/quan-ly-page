const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const core=fs.readFileSync(__dirname+'/../../js/core.js','utf8');
const traffic=core.slice(core.indexOf('App.graphTraffic ='),core.indexOf('async function guard('));
const login=core.slice(core.indexOf('// ── Đăng nhập'),core.indexOf('// ── Điều hướng'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(shared={},auto='0'){
  let now=1800000000000,handler=async()=>({data:[]});const calls=[],timers=[],nodes={};
  const $=id=>nodes[id]||=( {value:id==='appId'?'1062977306762250':'',textContent:'',disabled:false,hidden:false} );
  const local={get:key=>shared[key]??null,set:(key,value)=>shared[key]=value};shared.autoLogin=auto;
  const App={GRAPH:'https://graph.facebook.com/v25.0',DEFAULT_APP_ID:'1062977306762250',CONFIG_ID:'config',pages:[],NAV:{messages:[]},onLogin:[]};
  const FB={init(){},getLoginStatus(cb){FB.statusCalls++;cb({status:'unknown'});},statusCalls:0,loginCalls:0,login(cb){FB.loginCalls++;FB.finish=cb;}};
  const context=vm.createContext({App,$,local,URL,URLSearchParams,FormData,Set,Promise,Number,JSON,Date:class extends Date{static now(){return now;}},fetch:async(url,options)=>{calls.push({url:String(url),options});const reply=await handler(url,options);return {status:reply.status||200,headers:{get:key=>reply.headers?.[key]||null},json:async()=>reply};},window:{FB},FB,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},location:{reload(){}},DB:{get:async()=>({})},restoreSelectedPages:async()=>[],selected:new Set(),rememberSelectedPages(){},showGroup(){},h(){},document:{head:{append(){}}}});
  vm.runInContext(traffic+'\nthis.apiTest=api;',context);
  return {context,App,FB,calls,timers,nodes,shared,local,setHandler:fn=>handler=fn,advance:ms=>now+=ms,api:(...args)=>context.apiTest(...args),login(){vm.runInContext(login+'\nthis.startTest=start;',context);return context.startTest;}};
}
(async()=>{
  const shared={fbTok:'private'},a=harness(shared);a.setHandler(async()=>({error:{code:4,message:'Application request limit reached'}}));
  await assert.rejects(a.api('/me/accounts',{},'GET','private'),e=>e.code===4&&e.rateLimited&&Number.isFinite(e.retryAt));assert.equal(a.calls.length,1);
  await assert.rejects(a.api('/page/feed',{message:'Never send'},'POST','private'));assert.equal(a.calls.length,1,'mutations are blocked, never auto-retried');
  const reloaded=harness(shared);await assert.rejects(reloaded.api('/me/accounts',{},'GET','private'));assert.equal(reloaded.calls.length,0,'F5/another tab keeps the application cooldown');assert.ok(!JSON.stringify(Object.entries(shared).filter(([k])=>k.startsWith('graphTraffic'))).includes('private'));
  a.advance(16*60e3);a.setHandler(async()=>({data:[]}));await a.api('/me/accounts',{},'GET','private');assert.equal(a.calls.length,2,'explicit calls work after the local pause, no automatic request');
  const quota=harness();for(let i=0;i<40;i++)await quota.api('/customer',{},'GET','private',{background:true});await assert.rejects(quota.api('/customer',{},'GET','private',{background:true}),e=>e.code==='AVATAR_BUDGET');assert.equal(quota.calls.length,40);await quota.api('/me/accounts',{},'GET','private');assert.equal(quota.calls.length,41,'avatar budget does not block login');
  const pressure=harness();pressure.setHandler(async()=>({data:[],headers:{'x-app-usage':'{"call_count":85}'}}));await pressure.api('/messages',{},'GET','private');await assert.rejects(pressure.api('/customer',{},'GET','private',{background:true}),e=>e.code==='AVATAR_BUDGET');await pressure.api('/messages',{},'GET','private');assert.equal(pressure.calls.length,2);
  const bulk=harness(),photos={};bulk.context.DB={get:async(k,f)=>structuredClone(photos[k]??f),set:async(k,v)=>photos[k]=structuredClone(v)};
  bulk.context.pool=async(items,n,fn)=>{let index=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(index<items.length)await fn(items[index++]);}));};
  bulk.context.console={warn(){}};bulk.setHandler(async()=>({error:{code:100,error_subcode:33,message:'Unsupported get request'}}));
  vm.runInContext(core.slice(core.indexOf('const PIC_TTL'),core.indexOf('// Dòng Page nhỏ')),bulk.context);
  const ids=Array.from({length:100},(_,i)=>String(900000000123456+i)),page={id:'page',access_token:'secret'};
  // Meta từ chối hồ sơ khách (100/33, thiếu Business Asset User Profile Access): ngừng hỏi ảnh Page này sau vài khách.
  await bulk.App.customerPics(page,ids);assert.ok(bulk.calls.length<=8,'permission denial stops the Page after a few customers: '+bulk.calls.length);const denied=bulk.calls.length;
  assert.ok(bulk.context.App.graphTraffic.profileDeniedUntil('page')>Date.now(),'denial remembered');
  bulk.advance(2*60e3);await bulk.App.customerPics(page,ids);assert.equal(bulk.calls.length,denied,'no retries while permission is missing');
  bulk.advance(60*60e3);await bulk.App.customerPics(page,ids);assert.equal(bulk.calls.length,denied,'still paused after an hour, quota not wasted');
  const reloadDenied=harness(bulk.shared);await assert.rejects(reloadDenied.api('/cust',{fields:'profile_pic'},'GET','secret',{background:true,pageId:'page'}),e=>e.code==='AVATAR_PERMISSION');assert.equal(reloadDenied.calls.length,0,'pause survives reload');
  await reloadDenied.api('/page/messages',{},'POST','secret',{pageId:'page'});assert.equal(reloadDenied.calls.length,1,'messages and posts are never blocked by the avatar pause');
  bulk.advance(6*3600e3);bulk.setHandler(async(url)=>String(url).includes('/picture')?{data:{is_silhouette:false,url:'https://cdn.example/a.jpg'}}:{});
  const back=await bulk.App.customerPics(page,ids.slice(0,2),{force:true});assert.equal(back.get(ids[0]),'https://cdn.example/a.jpg','photos load again once Meta grants access');assert.equal(bulk.context.App.graphTraffic.profileDeniedUntil('page'),0,'success clears the pause');
  assert.ok(!JSON.stringify(photos).includes('secret'));
  // Lỗi khác (không phải thiếu quyền) vẫn bị giới hạn 40 lần/giờ.
  const budget=harness(),bp={};budget.context.DB={get:async(k,f)=>structuredClone(bp[k]??f),set:async(k,v)=>bp[k]=structuredClone(v)};budget.context.pool=bulk.context.pool;budget.context.console={warn(){}};
  budget.setHandler(async()=>({error:{code:2,message:'Temporary'}}));vm.runInContext(core.slice(core.indexOf('const PIC_TTL'),core.indexOf('// Dòng Page nhỏ')),budget.context);
  await budget.App.customerPics(page,ids);assert.equal(budget.calls.length,40,'100 missing avatars cannot create hundreds of Graph calls');
  budget.advance(2*60e3);await budget.App.customerPics(page,ids);assert.equal(budget.calls.length,40,'missing avatars are not retried each minute');
  budget.advance(60*60e3);await budget.App.customerPics(page,ids);assert.equal(budget.calls.length,80,'locally deferred customers resume after quota pause');
  const retry=harness();retry.setHandler(async()=>({status:429,headers:{'retry-after':'3600'}}));await assert.rejects(retry.api('/messages',{},'GET','private'),e=>e.retryAt===1800000000000+3600e3);
  const auth=harness({fbTok:'saved'},'1');auth.setHandler(async()=>({error:{code:4,message:'Application request limit reached'}}));vm.runInContext('this.apiPaged=async (path,params,token)=> (await api(path,params,"GET",token)).data;',auth.context);auth.login();await tick();await tick();assert.equal(auth.calls.length,1);assert.equal(auth.FB.statusCalls,0,'rate-limit error does not fall back to a second SDK login');assert.equal(auth.shared.fbTok,'saved','valid saved token kept');assert.equal(auth.nodes.fbLogin.disabled,true);assert.match(auth.nodes.loginStatus.textContent,/Meta đang giới hạn/);
  const fresh=harness(auth.shared,'1');vm.runInContext('this.apiPaged=async (path,params,token)=> (await api(path,params,"GET",token)).data;',fresh.context);fresh.login();await tick();assert.equal(fresh.calls.length,0);assert.equal(fresh.FB.statusCalls,0,'reload during cooldown neither fetches accounts nor starts OAuth');
  const concurrent=harness();let release;concurrent.setHandler(()=>new Promise(resolve=>release=()=>resolve({data:[{id:'page'}]})));vm.runInContext('this.apiPaged=async (path,params,token)=> (await api(path,params,"GET",token)).data;',concurrent.context);const start=concurrent.login(),one=start('new'),two=start('new');assert.equal(concurrent.calls.length,1,'concurrent starts coalesce');release();assert.deepEqual(await Promise.all([one,two]),[true,true]);assert.equal(concurrent.shared.fbTok,'new');
  const invalid=harness({fbTok:'expired'},'1');invalid.setHandler(async()=>({error:{code:190,message:'Expired token'}}));vm.runInContext('this.apiPaged=async (path,params,token)=> (await api(path,params,"GET",token)).data;',invalid.context);invalid.login();await tick();await tick();assert.equal(invalid.shared.fbTok,'');assert.equal(invalid.FB.statusCalls,1,'invalid token still allows SDK refresh');
  console.log('PASS: avatar pause on missing profile permission (persisted, auto-resume, never blocks sends), persistent shared rate-limit circuit, no duplicate requests or mutation retries, 100-customer avatar workload bounded with deferred recovery, foreground reserve, usage-header backoff, Retry-After, login deduplication, saved token retained on throttle and invalid token refresh.');
})().catch(error=>{console.error(error);process.exitCode=1;});
