// Nhắn khách quá 24 giờ: tin gõ tay ở Hộp thư được gửi lại kèm thẻ HUMAN_AGENT (tới 7 ngày); quá 7 ngày, gửi hàng loạt
// hoặc khi app chưa có quyền Human Agent thì không thử thẻ, báo rõ cách khác.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const core=fs.readFileSync(__dirname+'/../../js/core.js','utf8').replace(/\r/g,'');
const section=core.slice(core.indexOf('const MSG_DAY'),core.indexOf('App.recordTemplateUse'));
const DAY=864e5,page={id:'P',access_token:'t'};
function make(responder){
  const store={},calls=[];
  const ctx=vm.createContext({App:{},local:{get:k=>store[k]??null,set:(k,v)=>{store[k]=v;}},Date,Number,String,Object,Error,
    api:async(path,body)=>{calls.push(body.messaging_type+(body.tag?':'+body.tag:''));const e=responder(body,calls.length);if(e)throw e;return {message_id:'m'};}});
  vm.runInContext(section,ctx);return {App:ctx.App,calls,store};
}
const outside=()=>Object.assign(Error('(#10) This message is sent outside of allowed window.'),{code:10,sub:2018278});
(async()=>{
  // Trong 24 giờ: tin thường, không thẻ.
  let t=make(()=>null);await t.App.sendMessage(page,'U','hi',null,{humanAgent:true,lastCustomerAt:Date.now()-3600e3});
  assert.deepEqual(t.calls,['RESPONSE']);
  // Quá 24 giờ, còn trong 7 ngày: thử lại kèm HUMAN_AGENT.
  t=make(b=>b.tag?null:outside());
  const r=await t.App.sendMessage(page,'U','hi',null,{humanAgent:true,lastCustomerAt:Date.now()-2*DAY});
  assert.deepEqual(t.calls,['RESPONSE','MESSAGE_TAG:HUMAN_AGENT']);assert.equal(r.humanAgent,true);
  // App chưa được duyệt Human Agent: ghi nhớ 1 ngày, lần sau không gọi thử thẻ nữa.
  t=make(b=>b.tag?Object.assign(Error('(#10) Requires human_agent permission'),{code:10}):outside());
  await assert.rejects(t.App.sendMessage(page,'U','hi',null,{humanAgent:true,lastCustomerAt:Date.now()-2*DAY}),e=>e.window==='human'&&/Human Agent/.test(e.message));
  assert.equal(t.App.humanAgent.denied(),true);
  await assert.rejects(t.App.sendMessage(page,'U','hi',null,{humanAgent:true,lastCustomerAt:Date.now()-2*DAY}),e=>e.window==='human');
  assert.deepEqual(t.calls,['RESPONSE','MESSAGE_TAG:HUMAN_AGENT','RESPONSE'],'denied: no repeated tag attempts');
  t.App.humanAgent.reset();assert.equal(t.App.humanAgent.denied(),false,'"Thử lại" clears the memory once Meta approves');
  // Quá 7 ngày: không thẻ nào hợp lệ.
  t=make(()=>outside());
  await assert.rejects(t.App.sendMessage(page,'U','hi',null,{humanAgent:true,lastCustomerAt:Date.now()-8*DAY}),e=>e.window==='closed');
  assert.deepEqual(t.calls,['RESPONSE']);
  // Gửi hàng loạt / tự động: không bao giờ dùng HUMAN_AGENT (chính sách Meta).
  t=make(()=>outside());
  await assert.rejects(t.App.sendMessage(page,'U','hi',null),e=>e.sub===2018278&&!e.window);assert.deepEqual(t.calls,['RESPONSE']);
  assert.equal(t.App.humanAgent.windowOf(0),'unknown');assert.equal(t.App.humanAgent.windowOf(Date.now()-10*DAY),'closed');
  assert.match(t.App.businessInboxUrl('P','U'),/business\.facebook\.com\/latest\/inbox\/all\?asset_id=P&selected_item_id=U/);
  const inbox=fs.readFileSync(__dirname+'/../../js/inbox.js','utf8');
  assert.match(inbox,/humanAgent: true, lastCustomerAt: c\.lastCustomerAt/,'inbox manual replies opt in');
  assert.doesNotMatch(fs.readFileSync(__dirname+'/../../js/bulk.js','utf8'),/humanAgent/,'bulk send never uses the tag');
  console.log('PASS: >24h manual replies retried with HUMAN_AGENT up to 7 days, denial remembered with retry, >7 days and bulk never tagged, Business Suite fallback link.');
})().catch(e=>{console.error(e);process.exitCode=1;});
