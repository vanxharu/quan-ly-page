// Lịch đăng đối chiếu với bài hẹn thật trên Meta: không hẹn lại bài cùng nội dung, gắn mã bài cho bài hẹn qua Business Suite.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const planner=fs.readFileSync(__dirname+'/../../js/planner.js','utf8').replace(/\r/g,'');
const section=planner.slice(planner.indexOf('  const metaCache = new Map();'),planner.indexOf('  async function scheduleAll('));
function run(queue,metaPosts){
  const db={fbScheduleQueueV1:structuredClone(queue)},published=[],logs=[];
  const ctx=vm.createContext({QUEUE:'fbScheduleQueueV1',DB:{get:async(k,f)=>structuredClone(db[k]??f),set:async(k,v)=>{db[k]=structuredClone(v);}},
    pageOf:i=>({id:i.pageKey,name:'Page '+i.pageKey,access_token:'t'}),inSel:()=>true,STATUS:{scheduled:['Đã hẹn trên FB'],posted:['Đã đăng'],scheduling:['Đang']},
    norm:v=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim(),fmtTime:t=>String(t),refresh:()=>{},log:(c,t)=>logs.push(t),logLinks:()=>{},
    api:async()=>({data:metaPosts}),App:{planner:{},plannerRunning:new Set(),publish:async(p,text)=>{published.push(text);return {id:'NEW'};}},
    patch:async(id,ch)=>{db.fbScheduleQueueV1=db.fbScheduleQueueV1.map(i=>i.id===id?{...i,...ch}:i);},Date,Map,Set,Math,Number,String,Error});
  vm.runInContext(section+';this.one=scheduleOne;this.rec=reconcile;this.same=sameText;',ctx);
  return {ctx,db,published,logs};
}
(async()=>{
  const later=Date.now()+86400e3,text='Ưu đãi cuối tuần: giảm 20% toàn bộ dịch vụ tăng tương tác cho Fanpage. Inbox ngay!';
  // Bài đã hẹn trên Meta (có link khác) → không đăng lại, nhận mã bài của Meta.
  let t=run([{id:'a',status:'approved',pageKey:'1',at:later,text}],[{id:'1_99',message:text.replace('Inbox ngay!','Inbox ngay! https://m.me/x'),scheduled_publish_time:Math.floor(later/1000)}]);
  assert.equal(await t.ctx.one(t.db.fbScheduleQueueV1[0]),'dup');assert.equal(t.published.length,0,'never schedules a post Meta already has');
  assert.equal(t.db.fbScheduleQueueV1[0].status,'scheduled');assert.equal(t.db.fbScheduleQueueV1[0].fbPostId,'1_99');
  // Khác nội dung → hẹn bình thường.
  t=run([{id:'a',status:'approved',pageKey:'1',at:later,text}],[{id:'1_5',message:'Bài khác hoàn toàn về chủ đề khác nhé các bạn ơi',scheduled_publish_time:1}]);
  assert.equal(await t.ctx.one(t.db.fbScheduleQueueV1[0]),true);assert.deepEqual(t.published,[text]);
  // Hai bài trùng nhau trong danh sách cùng Page → bài thứ hai bị chặn.
  t=run([{id:'a',status:'scheduled',pageKey:'1',at:later,text},{id:'b',status:'approved',pageKey:'1',at:later+3600e3,text}],[]);
  assert.equal(await t.ctx.one(t.db.fbScheduleQueueV1[1]),'dup');assert.equal(t.published.length,0);assert.match(t.db.fbScheduleQueueV1[1].error,/Trùng nội dung/);
  // Cùng nội dung nhưng khác Page → được đăng.
  t=run([{id:'a',status:'scheduled',pageKey:'2',at:later,text},{id:'b',status:'approved',pageKey:'1',at:later,text}],[]);
  assert.equal(await t.ctx.one(t.db.fbScheduleQueueV1[1]),true);
  // Đối chiếu: bài hẹn qua Business Suite (chưa có mã) nhận mã; bài có mã mà Meta không còn → báo bị huỷ ngoài app.
  t=run([{id:'bs',status:'scheduled',pageKey:'1',at:later,text,viaBusinessSuite:true},{id:'old',status:'scheduled',pageKey:'1',at:later,text:'Một bài khác đủ dài để không bị coi là trùng nội dung',fbPostId:'1_gone'}],
    [{id:'1_77',message:text,scheduled_publish_time:Math.floor(later/1000)}]);
  await t.ctx.rec();
  assert.equal(t.db.fbScheduleQueueV1[0].fbPostId,'1_77');assert.equal(t.db.fbScheduleQueueV1[0].error,'');
  assert.equal(t.db.fbScheduleQueueV1[1].status,'error');assert.match(t.db.fbScheduleQueueV1[1].error,/huỷ ngoài app/);
  assert.equal(t.ctx.same('Chào','Chào bạn'),false,'short texts are not treated as prefix duplicates');
  console.log('PASS: scheduling skips posts already scheduled on Meta (link-insensitive) and same-Page duplicates in the list, other Pages unaffected, reconcile links Business Suite posts and flags posts cancelled outside the app.');
})().catch(e=>{console.error(e);process.exitCode=1;});
