// Ứng dụng nhận tin mặc định: kiểm tra bằng thread_owner, lưu 6 giờ, đánh dấu khi menu bị chặn; webhook tự lấy quyền khi nhận standby.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const bot=fs.readFileSync(__dirname+'/../../js/bot.js','utf8').replace(/\r/g,'');
const part=bot.slice(bot.indexOf('  const ROUTING_KEY'),bot.indexOf('  function routingCard('));
(async()=>{
  const store={},calls=[];let owner='1062977306762250',convs=[{other:{id:'U1'}}];let now=1800000000000;
  const App={DEFAULT_APP_ID:'1062977306762250',inbox:{convsFor:async()=>convs}};
  const ctx={App,$:()=>null,local:{get:k=>store[k]??null,set:(k,v)=>store[k]=v},JSON,String,Date:{now:()=>now},
    api:async(path,params)=>{calls.push(path+'?'+params.recipient);if(owner==='ERR')throw new Error('(#10) no permission');return {data:owner?[{thread_owner:{app_id:owner}}]:[]};}};
  vm.runInNewContext(part,ctx);const page={id:'P',access_token:'t'};
  assert.equal(JSON.stringify(await App.routing.check(page)),'{"status":"ok"}');assert.deepEqual([...calls],['/P/thread_owner?U1'],'one call per Page, using the latest conversation');
  owner='263902037430900';let r=await App.routing.check(page);assert.equal(r.status,'other');assert.equal(r.appName,'Inbox in Meta Business Suite');
  owner='170005996917513';assert.equal((await App.routing.check(page)).appName,'AhaChat');
  owner='';assert.equal((await App.routing.check(page)).status,'unknown','idle thread is not reported as wrong');
  owner='ERR';assert.equal((await App.routing.check(page)).status,'unknown');
  convs=[];calls.length=0;r=await App.routing.check(page);assert.equal(r.status,'unknown');assert.equal(calls.length,0,'no conversation → no Graph call');
  assert.ok(App.routing.get('P'),'result cached');now+=7*3600e3;assert.equal(App.routing.get('P'),null,'cache expires after 6 hours');
  App.routing.markBlocked('P');assert.equal(App.routing.get('P').status,'other','menu error marks the Page as not default');
  assert.match(bot,/msgr_conversation_routing/);assert.match(bot,/routingCard\(App\.selected\(\)\)/);assert.match(bot,/el\.replaceChildren\(routingCard\(pages\), form/);
  // Webhook: standby → take_thread_control → xử lý như tin thường
  process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='k';const logs=[],graph=[];let allowTake=true;
  global.fetch=async(url,opt={})=>{const u=new URL(url);
    if(u.hostname==='graph.facebook.com'){graph.push(u.pathname);if(u.pathname.endsWith('take_thread_control')&&!allowTake)return {json:async()=>({error:{message:'(#10) not allowed'}})};return {json:async()=>({success:true,name:'Lan'})};}
    const t=u.pathname.split('/').pop();if(t==='logs')logs.push(JSON.parse(opt.body));
    const out=t==='page_tokens'?[{token:'pt'}]:t==='page_settings'?[{bot_enabled:true}]:[];return {ok:true,text:async()=>JSON.stringify(out),json:async()=>out};};
  const ext=require.extensions['.ts'];require.extensions['.ts']=require.extensions['.js'];delete require.cache[require.resolve('../../server/fb-webhook.ts')];const wh=require('../../server/fb-webhook.ts');require.extensions['.ts']=ext;
  const ev={object:'page',entry:[{id:'P',standby:[{sender:{id:'U'},recipient:{id:'P'},message:{mid:'m1',text:'giá'}}]}]};
  await wh.handle(ev);assert.ok(graph.some(p=>p.endsWith('/P/take_thread_control')),'tries to take the thread');assert.ok(!logs.some(l=>l.detail?.where==='standby'),'no warning when takeover works');
  allowTake=false;await wh.handle(ev);await wh.handle(ev);assert.equal(logs.filter(l=>l.detail?.where==='standby').length,1,'warns once when Facebook refuses');
  console.log('PASS: routing check via thread_owner (ours/other/known names/idle/error/no conversation), 6h cache, menu-blocked marking, setup links in bot tabs; webhook takes thread control on standby messages and warns once when refused.');
})().catch(e=>{console.error(e);process.exitCode=1;});
