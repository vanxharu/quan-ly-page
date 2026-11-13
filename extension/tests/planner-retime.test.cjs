// Lên lịch tất cả: bài đã duyệt mà giờ đã qua (hoặc còn < 10 phút) được xếp sang giờ trống tiếp theo rồi hẹn, không báo lỗi "phải sau hiện tại 10 phút".
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=__dirname+'/../../js/';
const planner=fs.readFileSync(root+'planner.js','utf8').replace(/\r/g,'');
const section=planner.slice(planner.indexOf('  const metaCache = new Map();'),planner.indexOf('  async function autoTime() {'));
(async()=>{
  const now=Date.now(),db={fbScheduleQueueV1:[
    {id:'past',status:'approved',pageKey:'1',at:now-3600e3,text:'Bài đã qua giờ đăng, nội dung thứ nhất khá dài để không trùng'},
    {id:'soon',status:'approved',pageKey:'1',at:now+5*60e3,text:'Bài sắp tới giờ trong 5 phút, nội dung thứ hai khác hẳn bài một'},
    {id:'ok',status:'approved',pageKey:'2',at:now+2*86400e3,text:'Bài còn giờ hợp lệ trong tương lai, nội dung thứ ba riêng biệt'}],fbScheduleSettingsV1:{}},published=[],logs=[];
  const window={MetaAIProtocol:{}};window.window=window;vm.createContext(window);vm.runInContext(fs.readFileSync(root+'lib/pure.js','utf8'),window);
  const ctx=vm.createContext({Pure:window.Pure,QUEUE:'fbScheduleQueueV1',SETTINGS:'fbScheduleSettingsV1',DB:{get:async(k,f)=>structuredClone(db[k]??f),set:async(k,v)=>{db[k]=structuredClone(v);}},
    pageOf:i=>({id:i.pageKey,name:'Page '+i.pageKey,access_token:'t'}),inSel:()=>true,STATUS:{scheduled:['Đã hẹn trên FB'],posted:['Đã đăng'],scheduling:['Đang']},
    getSettings:async()=>({windows:window.Pure.DEFAULT_WINDOWS,perDay:1,weekdays:[0,1,2,3,4,5,6],days:[],pages:{}}),
    cfgFor:(s)=>({windows:window.Pure.parseWindows(s.windows),perDay:s.perDay,weekdays:s.weekdays}),
    norm:v=>String(v||'').toLowerCase(),fmtTime:t=>new Date(t).toISOString(),refresh:()=>{},log:(c,t)=>logs.push(t),logLinks:()=>{},
    $:()=>({replaceChildren(){},disabled:false}),api:async()=>({data:[]}),
    App:{planner:{},plannerRunning:new Set(),batchProgress:null,publish:async(p,text,o)=>{published.push(o?.scheduledAt||o?.at||text);return {id:'X'+published.length};}},
    patch:async(id,ch)=>{db.fbScheduleQueueV1=db.fbScheduleQueueV1.map(i=>i.id===id?{...i,...ch}:i);},Date,Map,Set,Math,Number,String,Error,Object,Promise,JSON});
  vm.runInContext(section+';this.all=scheduleAll;',ctx);
  await ctx.all();
  const q=Object.fromEntries(db.fbScheduleQueueV1.map(i=>[i.id,i]));
  for(const id of ['past','soon']){assert.ok(q[id].at>=Date.now()+10*60e3,id+' moved to a future slot');assert.equal(q[id].status,'scheduled',id+': '+q[id].error);}
  assert.equal(q.ok.at,now+2*86400e3,'valid time untouched');
  assert.notEqual(new Date(q.past.at).toDateString()+new Date(q.past.at).getHours(),new Date(q.soon.at).toDateString()+new Date(q.soon.at).getHours(),'same Page not stacked in the same hour');
  assert.match(logs.join(' '),/2 bài đã qua giờ đăng được xếp sang giờ trống/);
  console.log('PASS: approved posts whose time passed get the next free slot and are scheduled; valid times untouched.');
})().catch(e=>{console.error(e);process.exitCode=1;});
