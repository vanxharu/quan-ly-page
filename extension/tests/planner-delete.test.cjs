// Xoá bài trong Lịch đăng: chọn huỷ luôn bài hẹn trên Facebook hay chỉ xoá khỏi danh sách; bài đã đăng không bao giờ bị xoá trên FB.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const planner=fs.readFileSync(__dirname+'/../../js/planner.js','utf8').replace(/\r/g,'');
const section=planner.slice(planner.indexOf('  async function deleteItems('),planner.indexOf('  async function deleteAll('));
function run(queue,failId){
  const db={fbScheduleQueueV1:structuredClone(queue)},calls=[];
  const ctx=vm.createContext({QUEUE:'fbScheduleQueueV1',DB:{get:async(k,f)=>structuredClone(db[k]??f),set:async(k,v)=>{db[k]=structuredClone(v);}},
    pageOf:i=>i.pageKey==='gone'?null:{id:i.pageKey,name:'Page '+i.pageKey,access_token:'t'},
    api:async(path,p,method)=>{calls.push(method+' '+path);if(path==='/'+failId)throw Error('Facebook lỗi');return {success:true};},
    pool:async(items,n,fn)=>{for(const x of items)await fn(x);},Set,Error,String});
  vm.runInContext(section+';this.del=deleteItems;',ctx);
  return {ctx,db,calls};
}
(async()=>{
  const q=[{id:'a',status:'scheduled',fbPostId:'P_1',pageKey:'1'},{id:'b',status:'draft',pageKey:'1'},{id:'c',status:'posted',fbPostId:'P_2',pageKey:'1'},{id:'d',status:'scheduled',fbPostId:'P_3',pageKey:'2'},{id:'keep',status:'draft',pageKey:'9'}];
  let t=run(q);let r=await t.ctx.del(q.slice(0,4),true);
  assert.deepEqual(t.calls.sort(),['DELETE /P_1','DELETE /P_3'],'only scheduled posts are cancelled on Facebook, never published ones');
  assert.equal(r.cancelled,2);assert.equal(r.removed,4);assert.deepEqual(t.db.fbScheduleQueueV1.map(i=>i.id),['keep'],'items outside the selection stay');
  t=run(q);r=await t.ctx.del(q.slice(0,4),false);
  assert.equal(t.calls.length,0,'list-only mode never touches Facebook');assert.equal(r.removed,4);
  t=run(q,'P_3');r=await t.ctx.del(q.slice(0,4),true);
  assert.deepEqual(t.db.fbScheduleQueueV1.map(i=>i.id),['d','keep'],'a post Facebook refused to cancel stays in the list');assert.equal(r.failed.length,1);assert.match(r.failed[0],/Facebook lỗi/);
  const q2=[{id:'x',status:'scheduled',fbPostId:'P_9',pageKey:'gone'}];t=run(q2);r=await t.ctx.del(q2,true);
  assert.equal(r.removed,0,'disconnected Page: kept and reported instead of silently losing the scheduled post');assert.equal(r.failed.length,1);
  const posting=fs.readFileSync(__dirname+'/../../js/posting.js','utf8'),core=fs.readFileSync(__dirname+'/../../js/core.js','utf8');
  assert.match(core,/business\.facebook\.com\/latest\/posts\/scheduled_posts\?asset_id=/);
  assert.match(planner,/logLinks\(list\.map/,'links to Meta shown after scheduling');assert.match(planner,/Xoá tất cả bài/);
  assert.match(posting,/cancelAll\(\)/);assert.match(posting,/syncQueue\(\[p\.id\]\)/,'cancelling in the scheduled tab also clears the planner item');
  console.log('PASS: delete-all/one with choice (cancel on Facebook or list only), published posts never deleted on Facebook, failed cancels kept and reported, Meta scheduled-posts links after scheduling, cancel-all in scheduled tab synced with planner.');
})().catch(e=>{console.error(e);process.exitCode=1;});
