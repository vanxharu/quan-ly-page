// Dò bài thiếu: mỗi Page mỗi ngày phải có đủ Bài/ngày (tính bài hẹn trên Meta + bài trong danh sách); ngày thiếu → ô trống đúng Page/ngày.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=__dirname+'/../../js/';
const planner=fs.readFileSync(root+'planner.js','utf8').replace(/\r/g,'');
const section=planner.slice(planner.indexOf('  const metaCache = new Map();'),planner.indexOf('  async function autoTime() {'));
const at=(d,h)=>{const t=new Date();t.setDate(t.getDate()+d);t.setHours(h,0,0,0);return t.getTime();};
(async()=>{
  const W={MetaAIProtocol:{}};W.window=W;vm.createContext(W);vm.runInContext(fs.readFileSync(root+'lib/pure.js','utf8'),W);const dk=W.Pure.dayKeyOf;
  const db={fbScheduleQueueV1:[{id:'q',status:'approved',pageKey:'1',at:at(2,12),text:'đã có giờ'},{id:'x',status:'draft',pageKey:'1',at:0,text:'chưa có giờ, không tính'}]};
  const ctx=vm.createContext({Pure:W.Pure,QUEUE:'fbScheduleQueueV1',DB:{get:async(k,f)=>structuredClone(db[k]??f),set:async(k,v)=>{db[k]=structuredClone(v);}},
    pageOf:i=>({id:i.pageKey}),getSettings:async()=>({windows:W.Pure.DEFAULT_WINDOWS,perDay:1,weekdays:[1],days:[],pages:{}}),cfgFor:s=>({windows:W.Pure.parseWindows(s.windows),perDay:s.perDay,weekdays:s.weekdays}),
    ensureGolden:async()=>{},App:{planner:{},selected:()=>[{id:'1',name:'A',access_token:'t'},{id:'2',name:'B',access_token:'t'}],pageById:id=>({id,name:id})},
    api:async path=>path.endsWith('/scheduled_posts')&&path.startsWith('/2')?{data:[{id:'2_m',message:'hẹn tay',scheduled_publish_time:Math.floor(at(3,20)/1000)}]}:{data:[]},
    h:()=>({}),$:()=>null,log:()=>{},refresh:()=>{},norm:v=>String(v||''),Date,Map,Set,Math,Number,String,Object,Promise,JSON,Array,Error});
  vm.runInContext(section+';this.scan=gapScan;',ctx);
  const {days,plan}=await ctx.scan(dk(at(1,0)),dk(at(3,0)));
  assert.equal(days.length,3);
  const miss=k=>[...plan.filter(p=>p.key===k&&p.at).map(p=>dk(p.at))].sort();
  assert.deepEqual(miss('1'),[dk(at(1,0)),dk(at(3,0))],'Page 1 missing day 1 and 3 (day 2 has a timed post; untimed draft not counted)');
  assert.deepEqual(miss('2'),[dk(at(1,0)),dk(at(2,0))],'Page 2 missing day 1 and 2 (day 3 has a post scheduled on Meta), weekdays setting ignored');
  const past=await ctx.scan(dk(at(-5,0)),dk(at(-2,0)));assert.equal(past.days.length,0,'past days are not scanned');
  console.log('PASS: gap scan per Page/day counts Meta-scheduled and timed list posts, ignores untimed drafts and past days.');
})().catch(e=>{console.error(e);process.exitCode=1;});
