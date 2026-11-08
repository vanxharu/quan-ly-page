// Rà soát logic toàn web: gửi hàng loạt dừng khi Meta giới hạn và bỏ khách quá 24 giờ; webhook bỏ sự kiện không phải tin,
// quy tắc thiếu ưu tiên vẫn xếp đúng, token hết hạn được đọc lại; bộ đếm nhắc hẹn không nhân đôi; điều hướng tab cũ không lỗi.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=__dirname+'/../../';
const read=f=>fs.readFileSync(root+f,'utf8').replace(/\r/g,'');

// ── Gửi hàng loạt ─────────────────────────────────────────
async function bulkTest(){
  const src=read('js/bulk.js');
  const section=src.slice(src.indexOf('  // Biết giờ tin cuối'),src.indexOf('  function visible()'))+src.slice(src.indexOf('  const log ='),src.lastIndexOf('})();'));
  const now=Date.now(),page=id=>({id,name:'Page '+id,access_token:'t'});
  const targets=[
    {page:page('A'),other:{id:'1',name:'An'},lastCustomerAt:now-3600e3,key:'A|an'},
    {page:page('A'),other:{id:'2',name:'Bình'},lastCustomerAt:now-25*3600e3,key:'A|binh'},
    {page:page('A'),other:{id:'3',name:'Chi'},lastCustomerAt:now-60e3,key:'A|chi'},
    {page:page('A'),other:{id:'4',name:'Dung'},lastCustomerAt:now-60e3,key:'A|dung'},
    {page:page('B'),other:{id:'5',name:'Em'},lastCustomerAt:now-60e3,key:'B|em'}];
  const run=async failFor=>{
    const logs=[],sent=[],el=id=>({value:{bkMin:'3',bkMax:'3',bkEvery:'10',bkPause:'0',bkText:'Chào {tên}'}[id]||'',disabled:false,hidden:true,style:{},
      prepend:n=>logs.push(n.cls+' '+n.text),querySelectorAll:()=>id==='bkList'?targets.map(c=>({value:`${c.page.id}|${c.other.id}`})):[]});
    const ctx=vm.createContext({S:{running:false,stop:false},$:el,document:{querySelector:()=>({value:'text'})},confirm:()=>true,
      h:(t,p)=>({cls:p.className,text:p.textContent}),visible:()=>targets,sleep:async()=>{},Math,Date,Set,String,Number,
      App:{templates:{list:async()=>[]},resolveVars:t=>t,recordTemplateUse:async()=>{},crm:{update:async()=>{}},
        sendMessage:async(p,psid)=>{if(failFor[psid])throw failFor[psid];sent.push(psid);}}});
    vm.runInContext(section+';this.run=run;',ctx);await ctx.run();return {logs,sent};
  };
  let r=await run({});
  assert.deepEqual(r.sent,['1','3','4','5'],'customer past the 24h window is skipped, not sent');
  assert.ok(r.logs.some(l=>/Bình: đã quá 24 giờ/.test(l)));assert.match(r.logs.at(-1),/4 thành công, 0 lỗi, 1 bỏ qua/);
  const pageLimit=Object.assign(Error('Page bị giới hạn'),{rateLimited:true,pageId:'A'});
  r=await run({'3':pageLimit});
  assert.deepEqual(r.sent,['1','5'],'Page-level limit: the rest of that Page is skipped, other Pages continue');
  const appLimit=Object.assign(Error('App bị giới hạn'),{rateLimited:true});
  r=await run({'1':appLimit});
  assert.deepEqual(r.sent,[],'app-level limit stops the whole run');assert.match(r.logs.at(-1),/Đã dừng/);
  assert.match(src,/apiPaged\(`\/\$\{page\.id\}\/conversations`/,'loads up to 3 pages of conversations, not only the first 100');
}

// ── Webhook ───────────────────────────────────────────────
async function webhookTest(){
  const req=[];let tokenReads=0,failToken=false;
  process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service';
  global.fetch=async(url,opt={})=>{
    const u=new URL(url),method=opt.method||'GET';req.push(method+' '+u.hostname+u.pathname);
    if(u.hostname==='graph.facebook.com'){
      if(failToken&&u.pathname.endsWith('/messages'))return {json:async()=>({error:{message:'Session has expired',code:190}})};
      return {json:async()=>(u.pathname.endsWith('/messages')?{message_id:'m'}:{name:'Lan'})};
    }
    const table=u.pathname.split('/').pop();let out=[];
    if(table==='page_tokens'){tokenReads++;out=[{token:'pt'}];}
    else if(table==='page_settings')out=[{bot_enabled:true}];
    else if(table==='conversations'&&method==='GET')out=[{page_id:'P',psid:'U',name:'Lan',unread:0}];
    else if(table==='rules'&&method==='GET')out=[{id:'r1',enabled:true,keywords:['giá'],priority:null,reply:'Giá chung'},{id:'r2',enabled:true,keywords:['giá'],priority:5,reply:'Giá ưu tiên'}];
    return {ok:true,status:200,text:async()=>JSON.stringify(out),json:async()=>out};
  };
  delete require.cache[require.resolve(root+'server/fb-webhook.ts')];
  const ext=require.extensions['.ts'];require.extensions['.ts']=require.extensions['.js'];
  const wh=require(root+'server/fb-webhook.ts');require.extensions['.ts']=ext;
  await wh.handle({object:'page',entry:[{id:'P',messaging:[{sender:{id:'U'},recipient:{id:'P'},delivery:{mids:['m1']}},{sender:{id:'U'},recipient:{id:'P'},reaction:{reaction:'like'}}]}]});
  assert.ok(!req.some(r=>/POST db\.test\/rest\/v1\/messages/.test(r)),'delivery/reaction events do not create empty messages');
  assert.equal(wh.matchRule([{id:'a',enabled:true,keywords:['x'],priority:null},{id:'b',enabled:true,keywords:['x'],priority:3}],'x').id,'b','missing priority counts as 0');
  failToken=true;
  await wh.handle({object:'page',entry:[{id:'P',messaging:[{sender:{id:'U'},recipient:{id:'P'},message:{mid:'m2',text:'giá'}}]}]});
  const before=tokenReads;failToken=false;
  await wh.handle({object:'page',entry:[{id:'P',messaging:[{sender:{id:'U'},recipient:{id:'P'},message:{mid:'m3',text:'giá'}}]}]});
  assert.equal(tokenReads,before+1,'after a 190 token error the token is read again from the database');
  assert.match(read('server/fb-admin.ts'),/filter\(m => m\.title && m\.value\)/,'server menu skips items without a target, like the web');
}

// ── Web: các chỗ khác ─────────────────────────────────────
function webTest(){
  const crm=read('js/crm.js');
  const s=crm.slice(crm.indexOf('  let apptTimer'),crm.indexOf('  // ── Tab Khách hàng'));
  let intervals=0;const onLogin=[];
  vm.runInContext(s,vm.createContext({App:{onLogin},setInterval:()=>++intervals,DB:{},Date}));
  onLogin.forEach(f=>f());onLogin.forEach(f=>f());onLogin.forEach(f=>f());
  assert.equal(intervals,1,'logging in again does not add another reminder timer (no duplicate notifications)');
  assert.match(crm,/!!norm\(ctx\.name\)/,'manual orders are matched by name only when the customer has a name');
  const core=read('js/core.js');
  assert.match(core,/if\(id==='calendar'\)id='scheduled'/);assert.match(core,/if \(!g\) return;/,'unknown tab ids no longer break navigation');
  const tpl=read('js/templates.js');
  assert.match(tpl,/Xoá nhóm/);assert.match(tpl,/Đổi tên nhóm/);assert.match(tpl,/đang dùng cho mẫu/,'duplicate shortcut warning');
  assert.match(tpl,/\(await T\.list\(\)\)\.filter\(x => x\.id !== t\.id\)/,'delete re-reads the list instead of a stale copy');
  const bot=read('js/bot.js');
  assert.match(bot,/upsert\(\{ \.\.\.base, page_id: pageId/,'comment toggles work even before the Page has a settings row');
  assert.match(bot,/trỏ tới bước đã xoá/,'flow save refuses links to deleted steps');
  assert.match(read('js/comments.js'),/recipient: \{ comment_id: c\.id \}/,'private reply to a comment');
  assert.match(read('js/settings.js'),/l\.indexOf\(':'\)/,'label rules keep keywords that contain ":"');
}

(async()=>{
  await bulkTest();await webhookTest();webTest();
  console.log('PASS: bulk send skips >24h customers and stops on Meta limits; webhook ignores non-message events, null priority, re-reads expired tokens; single reminder timer; safe tab routing; template groups, shortcut check; comment private reply; bot settings upsert and flow validation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
