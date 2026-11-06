// Mô phỏng 1 giờ Hộp thư mở với 10 Page ở 2 tab: đếm số lần gọi Facebook, kiểm tra khoá theo Page và webhook.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/../../js/inbox.js','utf8');
const core=fs.readFileSync(__dirname+'/../../js/core.js','utf8');
const traffic=core.slice(core.indexOf('App.graphTraffic ='),core.indexOf('async function guard('));
const flush=async(n=8)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};

function world(){
  const shared={store:{},db:{},calls:[],now:1800000000000,reply:null};
  const pages=Array.from({length:10},(_,i)=>({id:String(100+i),name:'Page '+i,access_token:'tok'+i}));
  shared.pages=pages;
  return shared;
}
function tab(w,{visible=true,current='inbox'}={}){
  const intervals=[],timeouts=[],nodes={},listeners={};
  const node=()=>({value:'',hidden:false,disabled:false,textContent:'',children:[],dataset:{},replaceChildren(){},append(){},remove(){},setAttribute(){},querySelectorAll:()=>[],classList:{add(){}},scrollTop:0,scrollHeight:0,clientHeight:0});
  const $=id=>nodes[id]||=node();
  const local={get:k=>w.store[k]??null,set:(k,v)=>{w.store[k]=String(v);}};
  const DB={get:async(k,f)=>k in w.db?structuredClone(w.db[k]):f,set:async(k,v)=>{w.db[k]=structuredClone(v);}};
  const selected=new Set(w.pages.map(p=>p.id));
  const notes=[];
  const App={pages:w.pages,GRAPH:'https://graph.facebook.com/v25.0',DEFAULT_APP_ID:'app',onLogin:[],onPageChange:[],tabs:{},server:{livePages:new Set()},
    selected:()=>w.pages.filter(p=>selected.has(p.id)),isSelected:id=>selected.has(String(id)),pageById:id=>w.pages.find(p=>p.id===String(id)),
    current:()=>current,tab(name,def){App.tabs[name]=def;},templates:{picker:()=>({el:{}})},crm:{all:async()=>({}),allLabels:async()=>[]},
    crmKey:(p,n)=>p+'|'+n,avatar:()=>({classList:{add(){}}}),pageAvatarUrl:()=>'',notify:(t,b)=>notes.push(t),customerPics:async()=>new Map(),noteCustomerConversation:()=>false};
  const fetch=async url=>{const u=new URL(url);w.calls.push(u.pathname);const r=w.reply?.(u)||{};return {status:r.status||200,headers:{get:k=>r.headers?.[k]||null},json:async()=>r.body||{data:w.pages.map(()=>({id:'c'+u.pathname,updated_time:new Date(w.now).toISOString(),unread_count:1,participants:{data:[{id:'cust',name:'Khách'}]},messages:{data:[{from:{id:'cust'},created_time:new Date(w.now).toISOString()}]}})).slice(0,1),paging:{}}};};
  const ctx=vm.createContext({App,$,local,DB,URL,URLSearchParams,FormData:class{},JSON,Math,Number,String,Object,Array,Map,Set,Promise,Error,
    Date:class extends Date{constructor(...a){super(...(a.length?a:[w.now]));}static now(){return w.now;}},fetch,
    InboxRules:{SETTINGS_KEY:'s',withDefaults:v=>({webNotify:true,mutedPages:[],pollMinutes:2,waitMinutes:30,...(v||{})}),notifyAllowed:()=>true,formatWait:()=>''},
    document:{hidden:!visible,title:'',addEventListener:(n,f)=>listeners[n]=f,body:{append(){}}},window:{addEventListener(){}},
    setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},setTimeout:(fn,ms)=>{timeouts.push({fn,ms,at:w.now+(ms||0)});return timeouts.length;},clearTimeout(){},
    pool:async(items,n,fn)=>{let i=0;const out=[];await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k]);}}));return out;},
    h:()=>node(),icon:()=>node(),empty:()=>node(),tag:()=>node(),norm:v=>String(v||'').toLowerCase(),fmtShort:()=>'',fmtTime:()=>'',toast(){},guard:async(t,fn)=>fn(),fileToDataUrl:async()=>''});
  vm.runInContext(traffic+'\n'+source,ctx);
  return {App,ctx,notes,intervals,timeouts,
    async step(){for(const t of intervals)await t.fn();await flush();},
    async fireTimeouts(){const due=timeouts.filter(t=>t.at<=w.now);for(const t of due)timeouts.splice(timeouts.indexOf(t),1);for(const t of due)await t.fn();await flush();},
    async login(){for(const f of App.onLogin)await f();await flush();}};
}

(async()=>{
  // 1. 10 Page, 2 tab mở Hộp thư suốt 1 giờ.
  const w=world(),a=tab(w),b=tab(w);
  await a.login();await b.login();
  await a.App.tabs.inbox.refresh();await flush();
  w.calls.length=0;
  for(let t=0;t<3600e3;t+=15e3){w.now+=15e3;await a.step();await b.step();}
  const perHour=w.calls.length;
  assert.ok(!w.calls.some(p=>!p.endsWith('/conversations')),'no per-conversation rereads every few seconds');
  // Mỗi Page tối đa ~30 lần/giờ (danh sách 2 phút với >5 Page), dù 2 tab cùng mở.
  assert.ok(perHour<=10*31,'two tabs share one refresh schedule: '+perHour);
  assert.ok(perHour>=10*25,'list still refreshes regularly: '+perHour);

  // 1b. Page đã nối webhook máy chủ: danh sách quét thưa (5 phút), tin mới do webhook báo.
  const wl=world(),l=tab(wl);for(const p of wl.pages)l.App.server.livePages.add(p.id);
  await l.login();await l.App.tabs.inbox.refresh();await flush();wl.calls.length=0;
  for(let t=0;t<3600e3;t+=15e3){wl.now+=15e3;await l.step();}
  assert.ok(wl.calls.length<=10*13,'webhook Pages are refreshed every 5 minutes at most: '+wl.calls.length);
  const liveHour=wl.calls.length;

  // 2. Một Page bị Meta khoá (80006) không chặn Page khác.
  const w2=world(),c=tab(w2);
  w2.reply=u=>u.pathname.includes('/100/')?{body:{error:{code:80006,message:'Too many calls'}},headers:{'x-business-use-case-usage':JSON.stringify({100:[{type:'messenger',call_count:100,total_time:10,total_cputime:10,estimated_time_to_regain_access:30}]})}}:null;
  await c.login();
  const g=c.App.graphTraffic;
  assert.equal(g.until(),0,'app-wide lock not set by a Page-level limit');
  assert.ok(g.pageUntil('100')>=w2.now+30*60e3-1,'Page lock follows estimated_time_to_regain_access');
  w2.calls.length=0;w2.reply=null;w2.now+=5*60e3;await c.App.tabs.inbox.refresh();await flush();
  assert.ok(!w2.calls.some(p=>p.includes('/100/')),'locked Page not called again');
  assert.ok(w2.calls.some(p=>p.includes('/101/')),'other Pages keep working');

  // 3. Mức dùng ≥75%: quét nền tạm giãn, thao tác người dùng vẫn chạy.
  const w3=world(),d=tab(w3);w3.reply=u=>u.pathname.includes('/100/')?{headers:{'x-business-use-case-usage':JSON.stringify({100:[{type:'pages',call_count:80,total_time:5,total_cputime:5,estimated_time_to_regain_access:0}]})}}:null;
  await d.login();await d.App.tabs.inbox.refresh();await flush();
  assert.ok(d.App.graphTraffic.slowUntil('100')>w3.now,'high usage slows background work for that Page');
  await assert.rejects(d.ctx.api('/100/conversations',{},'GET','tok0',{low:true}),e=>e.code==='BACKGROUND_PAUSED');
  await d.ctx.api('/100/messages',{},'POST','tok0');

  // 4. Webhook báo Page có tin mới → tải lại đúng Page đó, báo tin một lần dù 2 tab.
  const w4=world(),e=tab(w4),f=tab(w4);await e.login();await f.login();
  w4.calls.length=0;w4.now+=20e3;
  w4.reply=u=>u.pathname.includes('/105/')?{body:{data:[{id:'new',updated_time:new Date(w4.now).toISOString(),unread_count:1,snippet:'Hi',participants:{data:[{id:'k',name:'Lan'}]},messages:{data:[{from:{id:'k'},created_time:new Date(w4.now).toISOString()}]}}],paging:{}}}:null;
  e.App.inbox.changed('105');f.App.inbox.changed('105');w4.now+=1e3;await e.fireTimeouts();await f.fireTimeouts();
  assert.deepEqual([...new Set(w4.calls)],['/v25.0/105/conversations'],'only the changed Page is fetched');
  assert.equal(w4.calls.length,1,'second tab reuses the first tab result');
  assert.equal(e.notes.length+f.notes.length,1,'one notification across tabs');

  console.log(`PASS: 10 Pages × 2 tabs = ${perHour} Graph calls/hour (was ~1,400+ per tab), ${liveHour}/hour with webhook, no 8-second rereads, Page-level lock isolation with regain time, background slow-down at 75% usage, webhook refresh of one Page with cross-tab dedupe.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
