// "Khách đã xem": máy chủ lưu mốc từ webhook message_reads; web đặt avatar khách dưới tin cuối Page khách đã xem.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const flush=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};

// ── Máy chủ ──────────────────────────────────────────────
async function serverTest(){
  const rows={},requests=[];
  process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service';
  global.fetch=async(url,opt={})=>{
    const u=new URL(url),method=opt.method||'GET';requests.push({path:u.pathname,search:decodeURIComponent(u.search),method});
    if(u.hostname==='graph.facebook.com')return {json:async()=>({name:'Lan',profile_pic:'https://cdn/p.jpg'})};
    const q=Object.fromEntries(u.searchParams),table=u.pathname.split('/').pop();
    const key=(q.page_id||'').replace('eq.','')+':'+(q.psid||'').replace('eq.','');
    let out=[];
    if(table==='page_tokens')out=[{token:'pt'}];
    else if(table==='page_settings')out=[{bot_enabled:false}];
    else if(table==='conversations'){
      if(method==='GET')out=rows[key]?[rows[key]]:[];
      if(method==='PATCH'){const b=JSON.parse(opt.body);const r=rows[key];const cond=q.or?.match(/read_watermark\.lt\."(.+)"\)/);
        if(r&&(!cond||!r.read_watermark||r.read_watermark<cond[1])){Object.assign(r,b);out=[r];}}
      if(method==='POST'){const b=JSON.parse(opt.body);const k=b.page_id+':'+b.psid;if(!rows[k])rows[k]={name:'',pic:'',unread:0,...b};}
    }
    return {ok:true,status:200,text:async()=>JSON.stringify(out),json:async()=>out};
  };
  delete require.cache[require.resolve('../../server/fb-webhook.ts')];
  const ext=require.extensions['.ts'];require.extensions['.ts']=require.extensions['.js'];
  const wh=require('../../server/fb-webhook.ts');require.extensions['.ts']=ext;
  const read=(w)=>wh.handle({object:'page',entry:[{id:'P',messaging:[{sender:{id:'U'},recipient:{id:'P'},read:{watermark:w}}]}]});
  await read(Date.parse('2026-11-06T10:00:00Z'));
  assert.equal(rows['P:U'].read_watermark,'2026-11-06T10:00:00.000Z','read receipt stored even before the first customer message');
  await read(Date.parse('2026-11-06T09:00:00Z'));
  assert.equal(rows['P:U'].read_watermark,'2026-11-06T10:00:00.000Z','older read event never moves the mark back');
  await read(Date.parse('2026-11-06T11:00:00Z'));
  assert.equal(rows['P:U'].read_watermark,'2026-11-06T11:00:00.000Z');
  assert.ok(!requests.some(r=>r.path.includes('/messages')&&r.method==='POST'&&r.path.includes('graph')),'read events never send messages');
  await wh.handle({object:'page',entry:[{id:'P',messaging:[{sender:{id:'U'},recipient:{id:'P'},message:{mid:'m1',text:'hi'}}]}]});
  assert.equal(rows['P:U'].name,'Lan','name filled in when the customer later writes');
  assert.match(fs.readFileSync(__dirname+'/../../server/fb-admin.ts','utf8'),/message_reads/,'Pages subscribe to message_reads');
  assert.match(fs.readFileSync(__dirname+'/../../server/schema.sql','utf8'),/add column if not exists read_watermark/);
}

// ── Web ──────────────────────────────────────────────────
function webTest(){
  const src=fs.readFileSync(__dirname+'/../../js/inbox.js','utf8').replace(/\r/g,'');
  const section=src.slice(src.indexOf('  // ── Khách đã xem'),src.indexOf('  // ── Soạn tin & mẫu'));
  class El{constructor(cls='',ds={}){this.className=cls;this.dataset=ds;this.parent=null;this.children=[];}
    after(n){const kids=this.parent.children;n.parent=this.parent;kids.splice(kids.indexOf(this)+1,0,n);} remove(){const k=this.parent.children;k.splice(k.indexOf(this),1);}}
  const thread=new El('thread');
  thread.querySelectorAll=sel=>sel==='.seen-row'?thread.children.filter(c=>c.className==='seen-row'):thread.children.filter(c=>c.className.startsWith('msgrow'));
  const row=(at,me)=>{const r=new El('msgrow'+(me?' me':''),{at:String(Date.parse(at)),me:me?'1':''});r.parent=thread;return r;};
  const changed=[];
  const App={inbox:{changed:id=>changed.push(id)},avatar:(n,u,size)=>({avatar:n,size}),server:{}};
  const S={pics:new Map(),conv:null};
  const ctx=vm.createContext({App,S,$:()=>thread,h:(t,p,...k)=>Object.assign(new El(p.className),{title:p.title,kids:k}),fmtTime:v=>v,retryPicture(){},pictureKey:c=>c.page.id+':'+c.other.id,Map,Date,Number,String});
  vm.runInContext(section+';this.drawSeen=drawSeen;',ctx);
  const c={page:{id:'P'},other:{id:'U',name:'Sally Wong'}};S.conv=c;
  thread.children=[row('2026-11-06T08:00:00Z',false),row('2026-11-06T08:05:00Z',true),row('2026-11-06T08:06:00Z',true),row('2026-11-06T08:30:00Z',true)];
  App.inbox.realtime({page_id:'P',psid:'U',last_at:'x',read_watermark:'2026-11-06T08:10:00Z'});
  const seen=thread.children.filter(c=>c.className==='seen-row');
  assert.equal(seen.length,1,'one seen marker');
  assert.equal(thread.children.indexOf(seen[0]),3,'placed under the last Page message the customer read, not the unread one');
  assert.equal(seen[0].kids[0].avatar,'Sally Wong');assert.equal(seen[0].kids[0].size,16);
  assert.deepEqual(changed,['P'],'first realtime event refreshes once');
  App.inbox.realtime({page_id:'P',psid:'U',last_at:'x',read_watermark:'2026-11-06T09:00:00Z'});
  assert.deepEqual(changed,['P'],'read-only change does not reload conversations from Facebook');
  assert.equal(thread.children.indexOf(thread.children.find(c=>c.className==='seen-row')),4,'marker moves to the newest read message');
  assert.equal(thread.children.filter(c=>c.className==='seen-row').length,1);
  thread.children=thread.children.filter(c=>c.className!=='seen-row');thread.children.push(row('2026-11-06T09:30:00Z',false));
  ctx.drawSeen(c);
  assert.equal(thread.children.filter(c=>c.className==='seen-row').length,0,'hidden when the customer replied afterwards');
  App.inbox.realtime({page_id:'P',psid:'U',last_at:'y',read_watermark:'2026-11-06T09:00:00Z'});
  assert.deepEqual(changed,['P','P'],'a new message still refreshes the list');
}

(async()=>{await serverTest();webTest();console.log('PASS: message_reads stored per customer (monotonic, before first message, no bot reply), webhook subscribed, seen avatar under last read Page message, moves on new reads, hidden after customer reply, read-only updates make no Graph calls.');})()
  .catch(e=>{console.error(e);process.exitCode=1;});
