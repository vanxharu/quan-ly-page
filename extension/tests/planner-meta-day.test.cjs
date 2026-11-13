// Mỗi Page N bài/ngày, tính cả bài hẹn thật trên Meta và bài đã đăng hôm nay: bài trùng ngày tự dời sang ngày trống kế tiếp.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=__dirname+'/../../js/';
const planner=fs.readFileSync(root+'planner.js','utf8').replace(/\r/g,'');
const section=planner.slice(planner.indexOf('  const metaCache = new Map();'),planner.indexOf('  async function autoTime() {'));
const day=(d,h)=>{const t=new Date();t.setDate(t.getDate()+d);t.setHours(h,0,0,0);return t.getTime();};
(async()=>{
  const W={MetaAIProtocol:{}};W.window=W;vm.createContext(W);vm.runInContext(fs.readFileSync(root+'lib/pure.js','utf8'),W);
  const metaPosts={'1':[{id:'1_m',message:'Bài hẹn tay trong Business Suite, nội dung hoàn toàn khác',scheduled_publish_time:Math.floor(day(2,20)/1000)}]};
  const db={fbScheduleQueueV1:[
    {id:'a',status:'approved',pageKey:'1',at:day(2,12),text:'Bài A trong app, trùng ngày với bài hẹn tay trên Meta của Page 1'},
    {id:'b',status:'approved',pageKey:'1',at:day(3,12),text:'Bài B trong app, ngày còn trống nên giữ nguyên giờ đã xếp'},
    {id:'c',status:'approved',pageKey:'1',at:day(3,19),text:'Bài C cùng ngày với bài B trong danh sách, phải dời sang ngày khác'},
    {id:'d',status:'approved',pageKey:'2',at:day(2,12),text:'Bài D của Page 2 cùng ngày nhưng khác Page nên không bị ảnh hưởng'}],fbScheduleSettingsV1:{}},logs=[];
  const ctx=vm.createContext({Pure:W.Pure,QUEUE:'fbScheduleQueueV1',SETTINGS:'fbScheduleSettingsV1',DB:{get:async(k,f)=>structuredClone(db[k]??f),set:async(k,v)=>{db[k]=structuredClone(v);}},
    pageOf:i=>({id:i.pageKey,name:'Page '+i.pageKey,access_token:'t'}),inSel:()=>true,STATUS:{scheduled:['Đã hẹn trên FB'],posted:['Đã đăng'],scheduling:['Đang']},
    getSettings:async()=>({windows:W.Pure.DEFAULT_WINDOWS,perDay:1,weekdays:[0,1,2,3,4,5,6],days:[],pages:{}}),cfgFor:s=>({windows:W.Pure.parseWindows(s.windows),perDay:s.perDay,weekdays:s.weekdays}),
    norm:v=>String(v||'').toLowerCase(),fmtTime:t=>String(t),refresh:()=>{},log:(c,t)=>logs.push(t),logLinks:()=>{},$:()=>({replaceChildren(){},disabled:false}),ensureGolden:async()=>{},
    api:async(path)=>{const id=path.split('/')[1];if(path.endsWith('/scheduled_posts'))return {data:metaPosts[id]||[]};if(path.endsWith('/published_posts'))return {data:[]};return {data:[]};},
    App:{pageById:id=>({id,name:'Page '+id,access_token:'t'}),planner:{},plannerRunning:new Set(),batchProgress:null,publish:async()=>({id:'NEW'})},
    patch:async(id,ch)=>{db.fbScheduleQueueV1=db.fbScheduleQueueV1.map(i=>i.id===id?{...i,...ch}:i);},Date,Map,Set,Math,Number,String,Error,Object,Promise,JSON,Array});
  vm.runInContext(section+';this.all=scheduleAll;',ctx);
  await ctx.all();
  const q=Object.fromEntries(db.fbScheduleQueueV1.map(i=>[i.id,i])),dk=W.Pure.dayKeyOf;
  for(const id of 'abcd')assert.equal(q[id].status,'scheduled',id+': '+q[id].error);
  assert.notEqual(dk(q.a.at),dk(day(2,0)),'A moved off the day Meta already has a post');
  assert.equal(q.b.at,day(3,12),'B keeps its free day');
  assert.notEqual(dk(q.c.at),dk(day(3,0)),'C moved: day already has B');
  assert.equal(q.d.at,day(2,12),'other Page unaffected');
  const days1=['a','b','c'].map(id=>dk(q[id].at));assert.equal(new Set([...days1,dk(day(2,0))]).size,4,'Page 1: one post per day including the Meta one');
  console.log('PASS: 1 post/day per Page counting Meta-scheduled posts; clashing posts moved to the next free day, others untouched.');
})().catch(e=>{console.error(e);process.exitCode=1;});
