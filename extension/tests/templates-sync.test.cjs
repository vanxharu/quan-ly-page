// Mẫu tin lưu theo tài khoản máy chủ: máy A sửa → máy B kéo về; đổi tài khoản → bộ của tài khoản đó; máy chủ chưa có → đẩy bộ ở máy lên.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const src=fs.readFileSync(__dirname+'/../../js/templates.js','utf8');
const section=src.slice(src.indexOf('  // ── Đồng bộ theo tài khoản'),src.indexOf('  let cat = ', src.indexOf('  // ── Đồng bộ theo tài khoản')));
const table=new Map(); // user_id -> row
let clock=0;
function machine(initial){
  const db=structuredClone(initial),listeners={},server={user:null,sb:{from:()=>({
    upsert:async row=>{table.set(row.user_id,{...structuredClone(row),updated_at:'t'+(++clock)});return{};},
    select:()=>({eq:(c,id)=>({maybeSingle:async()=>({data:table.has(id)?structuredClone(table.get(id)):null})})})})}};
  // upsert lưu updated_at do máy chủ đặt: giả lập bằng giá trị client gửi
  server.sb.from=()=>({upsert:async row=>{table.set(row.user_id,structuredClone(row));return{};},
    select:()=>({eq:(c,id)=>({maybeSingle:async()=>({data:table.has(id)?structuredClone(table.get(id)):null})})})});
  const DB={get:async(k,f)=>structuredClone(db[k]??f),set:async(k,v)=>{db[k]=structuredClone(v);(listeners[k]||[]).forEach(fn=>fn(v));}};
  const T={};let pending=[];
  const ctx=vm.createContext({DB,T,App:{server,on:(k,fn)=>(listeners[k]||=[]).push(fn),current:()=>''},ensure:async()=>{},
    setTimeout:(fn)=>{pending.push(fn);return pending.length;},clearTimeout:()=>{pending=[];},setInterval:()=>{},addEventListener:()=>{},
    Date:class extends Date{toISOString(){return 't'+(++clock);}},Promise,Object,Array,String});
  vm.runInContext(section,ctx);
  return {db,server,T,DB,flush:async()=>{const p=pending;pending=[];for(const f of p)await f();}};
}
(async()=>{
  const u1={id:'u1',email:'a@x'},u2={id:'u2',email:'b@x'};
  const A=machine({templates:[{id:'1',title:'Chào'}],categories:[],tags:[]});A.server.user=u1;
  await A.T.pull();assert.deepEqual(table.get('u1').data.templates,[{id:'1',title:'Chào'}],'empty server gets this machine\'s set');
  const B=machine({templates:[{id:'x',title:'Mẫu mặc định'}],categories:[],tags:[]});B.server.user=u1;
  await B.T.pull();assert.deepEqual(B.db.templates,[{id:'1',title:'Chào'}],'another machine gets the account\'s set');
  await A.DB.set('templates',[{id:'1',title:'Chào'},{id:'2',title:'Giá'}]);await A.flush();
  await B.T.pull();assert.equal(B.db.templates.length,2,'edit on machine A reaches machine B');
  // Máy B sửa nhưng chưa kịp đẩy (mất mạng) → lần kéo sau đẩy bản của B lên, không bị bản máy chủ đè.
  await B.DB.set('templates',[{id:'3',title:'Ship'}]);
  await B.T.pull();assert.deepEqual(table.get('u1').data.templates,[{id:'3',title:'Ship'}]);
  // Đổi sang tài khoản khác chưa có gì trên máy chủ: đẩy bộ đang có lên cho tài khoản đó; tài khoản cũ không bị đụng tới.
  B.server.user=u2;await B.T.pull();assert.deepEqual(table.get('u2').data.templates,[{id:'3',title:'Ship'}]);
  assert.deepEqual(table.get('u1').data.templates,[{id:'3',title:'Ship'}]);
  table.set('u2',{user_id:'u2',data:{templates:[{id:'9',title:'Riêng u2'}],categories:[],tags:[]},updated_at:'zz'});
  await B.T.pull();assert.deepEqual(B.db.templates,[{id:'9',title:'Riêng u2'}],'account switch loads that account\'s templates');
  console.log('PASS: templates follow the bot-server account across machines (first push, pull, edits pushed, unsynced local edits win, per-account sets).');
})().catch(e=>{console.error(e);process.exitCode=1;});
