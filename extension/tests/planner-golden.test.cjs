// Giờ vàng: tính 3 giờ tương tác cao nhất từ bài cũ của Page; Xếp giờ tự động dùng giờ vàng và xếp lại cả bài đã có giờ (khi đồng ý).
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=__dirname+'/../../js/';
const planner=fs.readFileSync(root+'planner.js','utf8').replace(/\r/g,'');
const cut=(a,b)=>planner.slice(planner.indexOf(a),planner.indexOf(b));
const section=cut('  const GOLDEN_FALLBACK','  App.tab(')+cut('  // Xếp giờ trống','  // ── Khung giờ & ngày đăng');
const at=(d,h)=>new Date(2026,9,d,h,10).toISOString();
// 40 bài: 20h và 12h tương tác cao, 9h thấp; 21h chỉ 1 bài rất cao (không đủ 2 bài → bỏ qua).
const posts=[];for(let d=1;d<=10;d++){posts.push({created_time:at(d,20),reactions:{summary:{total_count:80}},comments:{summary:{total_count:10}}},{created_time:at(d,12),reactions:{summary:{total_count:50}}},{created_time:at(d,9),reactions:{summary:{total_count:5}}},{created_time:at(d,7),reactions:{summary:{total_count:20}}});}
posts.push({created_time:at(11,21),reactions:{summary:{total_count:5000}}});
(async()=>{
  const W={MetaAIProtocol:{}};W.window=W;vm.createContext(W);vm.runInContext(fs.readFileSync(root+'lib/pure.js','utf8'),W);
  const db={fbScheduleSettingsV1:{goldenHours:true},fbScheduleQueueV1:[]},logs=[];let asked=0;
  const ctx=vm.createContext({Pure:W.Pure,SETTINGS:'fbScheduleSettingsV1',QUEUE:'fbScheduleQueueV1',DB:{get:async(k,f)=>structuredClone(db[k]??f),set:async(k,v)=>{db[k]=structuredClone(v);}},
    App:{planner:{},pageById:id=>({id,name:'Page '+id,access_token:'t'}),isSelected:()=>true},apiPaged:async()=>posts,
    pageOf:i=>({id:i.pageKey}),getSettings:async()=>({windows:W.Pure.DEFAULT_WINDOWS,perDay:1,weekdays:[0,1,2,3,4,5,6],days:[],pages:{},...db.fbScheduleSettingsV1}),
    $:()=>({replaceChildren(){}}),metaBusy:async()=>[],log:(c,t)=>logs.push(t),refresh:()=>{},confirm:()=>(asked++,true),Date,Map,Set,Math,Number,String,Object,Promise,JSON,Array});
  vm.runInContext(section+';this.golden=goldenWindows;this.autoTime=autoTime;this.cfgFor=cfgFor;',ctx);
  assert.equal(ctx.golden(posts),'07:00–08:00, 12:00–13:00, 20:00–21:00','top 3 hours by smoothed engagement, single outlier hour ignored');
  assert.equal(ctx.golden(posts.slice(0,10)),null,'too few posts → fallback');
  const now=Date.now();
  db.fbScheduleQueueV1=[{id:'a',status:'approved',pageKey:'1',at:now+3*864e5,text:'x'},{id:'b',status:'error',pageKey:'1',at:now-3600e3,error:'Giờ đăng phải sau…',text:'y'},{id:'c',status:'draft',pageKey:'1',text:'z'},{id:'s',status:'scheduled',pageKey:'1',at:now+864e5,text:'w'}];
  await ctx.autoTime();
  const q=Object.fromEntries(db.fbScheduleQueueV1.map(i=>[i.id,i]));
  assert.equal(asked,1,'asks before re-timing posts that already had a time');
  for(const id of ['a','b','c']){const d=new Date(q[id].at),m=d.getHours()*60+d.getMinutes();assert.ok([[420,480],[720,780],[1200,1260]].some(([a,b])=>m>=a&&m<=b),id+' placed in a golden hour, got '+d.toTimeString());}
  assert.equal(q.b.status,'approved');assert.equal(q.b.error,'');
  assert.equal(q.s.at,now+864e5,'already scheduled on Facebook stays');
  assert.match(logs.join(' '),/Giờ vàng — Page 1: 07:00–08:00, 12:00–13:00, 20:00–21:00/);
  assert.equal(db.fbScheduleSettingsV1.golden['1'].n,posts.length,'golden hours cached in settings');
  console.log('PASS: golden hours = top engagement hours of the Page (fallback when little data); auto-time re-times already-timed posts after asking, uses golden hours, leaves Facebook-scheduled posts.');
})().catch(e=>{console.error(e);process.exitCode=1;});
