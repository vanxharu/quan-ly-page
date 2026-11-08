// Menu & lời chào: xoá bằng tên viết hoa (không có GREETING), lỗi "chưa là ứng dụng chính" không làm hỏng phần còn lại,
// webhook báo rõ khi Facebook chỉ gửi bản standby.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const bot=fs.readFileSync(__dirname+'/../../js/bot.js','utf8').replace(/\r/g,'');
const part=bot.slice(bot.indexOf('  const NOT_PRIMARY'),bot.indexOf('  // ── Menu & lời chào ──'));
const App={};vm.runInNewContext(part,{App,api:null,Error,RegExp});
const page={id:'P',access_token:'tok'};
function caller(fail){const calls=[];return {calls,call:async(path,params,method,token)=>{calls.push({path,params:JSON.parse(JSON.stringify(params)),method,token});if(fail&&method==='POST'&&params.persistent_menu)throw new Error(fail);return {result:'success'};}};}
(async()=>{
  let c=caller();let r=await App.applyMessengerProfile(page,{greeting:'',persistent_menu:[],ice_breakers:[]},c.call);
  assert.equal(c.calls[0].method,'POST');assert.equal(c.calls[0].params.greeting,undefined);
  assert.deepEqual(c.calls[1],{path:'/me/messenger_profile',params:{fields:['PERSISTENT_MENU','ICE_BREAKERS']},method:'DELETE',token:'tok'},'delete uses Facebook\'s uppercase names and never "greeting"');
  assert.ok(!JSON.stringify(c.calls).includes('"greeting"]'));assert.match(r.notes.join(' '),/giữ lời chào cũ/);
  const full={greeting:'Chào {{user_first_name}}',persistent_menu:[{title:'Cần tư vấn',type:'flow',value:'f1'}],ice_breakers:[{question:'Ship tỉnh?'}]};
  c=caller();r=await App.applyMessengerProfile(page,full,c.call);assert.equal(c.calls.length,1,'nothing to delete when all set');assert.equal(c.calls[0].params.persistent_menu[0].call_to_actions[0].payload,'FLOW:f1');assert.equal(r.menuBlocked,false);
  c=caller('(#100) Không thể đặt menu cố định vì bạn chưa đặt ứng dụng của mình làm ứng dụng chính/mặc định cho trang.');r=await App.applyMessengerProfile(page,full,c.call);
  assert.equal(c.calls.length,2,'retried once without the menu');assert.equal(c.calls[1].params.persistent_menu,undefined);assert.equal(c.calls[1].params.greeting[0].text,'Chào {{user_first_name}}');assert.ok(c.calls[1].params.ice_breakers);
  assert.ok(!c.calls.some(x=>x.method==='DELETE'),'the existing menu is not deleted just because it could not be updated');assert.equal(r.menuBlocked,true);assert.match(r.notes[0],/ứng dụng nhận tin chính/);
  c=caller('Invalid OAuth access token');await assert.rejects(App.applyMessengerProfile(page,full,c.call),/Invalid OAuth/,'other errors are reported, not swallowed');
  assert.match(bot,/App\.applyMessengerProfile\(live, row\)/,'menu save applies with the fresh login token');
  const admin=fs.readFileSync(__dirname+'/../../server/fb-admin.ts','utf8');
  assert.match(admin,/\['persistent_menu', 'PERSISTENT_MENU'\], \['ice_breakers', 'ICE_BREAKERS'\]/);assert.ok(!/\['greeting', 'persistent_menu', 'ice_breakers'\]/.test(admin),'server no longer sends lowercase greeting');
  // Webhook standby
  process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='k';const logs=[];
  global.fetch=async(url,opt={})=>{const u=new URL(url),t=u.pathname.split('/').pop();if(t==='logs'){logs.push(JSON.parse(opt.body));}
    const out=t==='page_tokens'?[{token:'pt'}]:t==='page_settings'?[{bot_enabled:true}]:[];return {ok:true,text:async()=>JSON.stringify(out),json:async()=>out};};
  const ext=require.extensions['.ts'];require.extensions['.ts']=require.extensions['.js'];const wh=require('../../server/fb-webhook.ts');require.extensions['.ts']=ext;
  const ev={object:'page',entry:[{id:'P',standby:[{sender:{id:'U'},recipient:{id:'P'},message:{mid:'m',text:'giá'}}]}]};
  await wh.handle(ev);await wh.handle(ev);
  const warn=logs.filter(l=>l.detail?.where==='standby');assert.equal(warn.length,1,'standby warning logged once per Page, not per message');assert.match(warn[0].detail.message,/Primary receiver/);
  console.log('PASS: Messenger profile deletes with uppercase fields (never greeting), menu blocked by non-primary app falls back without breaking greeting/ice breakers or deleting the old menu, other errors surface, fresh login token used, webhook warns once on standby-only delivery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
