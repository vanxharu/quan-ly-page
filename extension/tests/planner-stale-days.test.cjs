// "Xếp giờ tự động" xếp 0 bài khi các ngày đăng đã chọn trước đó đều đã qua (lịch chọn không còn hiện chúng).
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ctx=vm.createContext({window:{},Date,Math,Number,String,Array,Set,Map,Object,JSON,MetaAIProtocol:{WORKFLOW:'w',POST_PROMPT:'',IMAGE_PROMPT:''}});
vm.runInContext(fs.readFileSync(__dirname+'/../../js/lib/pure.js','utf8'),ctx);const Pure=ctx.window.Pure;
const now=new Date(2026,10,8,22,18).getTime(),cfg={windows:Pure.parseWindows(Pure.DEFAULT_WINDOWS),perDay:1,weekdays:[0,1,2,3,4,5,6]};
const pages=[{key:'A',cfg},{key:'B',cfg}],stale=['2026-11-01','2026-11-02','2026-11-03'];
assert.equal(Pure.planTimes(pages,stale,[],now).filter(p=>p.at).length,0,'past days alone can never produce a slot');
const days=Pure.activeDays(stale,now);
assert.equal(days.length,14,'only past days chosen → fall back to the next 14 days');assert.equal(days[0],'2026-11-08');
assert.ok(Pure.planTimes(pages,days,[],now).filter(p=>p.at).length>=4,'4 posts on 2 Pages now get times');
assert.deepEqual([...Pure.activeDays(['2026-11-01','2026-11-20','2026-11-12'],now)],['2026-11-12','2026-11-20'],'future picks kept, past dropped');
const perPage=[{key:'A',cfg:{...cfg,days:['2026-11-02']}}];
const pp=Pure.planTimes(perPage,days,[],now).filter(p=>p.at);assert.ok(pp.length>0&&pp.every(p=>p.day>='2026-11-08'),'a Page whose own days are all past falls back to the shared days, never the past day');
const planner=fs.readFileSync(__dirname+'/../../js/planner.js','utf8');
assert.match(planner,/Pure\.activeDays\(s\.days\)/,'auto-time uses only active days');
assert.match(planner,/chưa chọn ngày nào trong tuần/,'unscheduled posts get a per-Page reason');
console.log('PASS: past posting days dropped (fallback to next 14 days), future picks kept, per-Page past days fall back to shared days, per-Page reason shown when posts stay unscheduled.');
