// Token Page trên máy chủ bị Facebook huỷ: web tự gọi lại "connect" bằng phiên Facebook hiện tại rồi chạy lại thao tác.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const src=fs.readFileSync(__dirname+'/../../js/server.js','utf8').replace(/\r/g,'');
const part=src.slice(src.indexOf('  // Token Page lưu trên máy chủ bị Facebook huỷ'),src.indexOf('  };',src.indexOf('S.callWithFreshToken'))+4);
function make({stale=true,connectOk=true,missing=false,user='USER'}={}){
  const calls=[];let fresh=!stale;
  const S={call:async(action,body)=>{calls.push(action+':'+(body.pageId||body.pageIds));
    if(action==='connect'){fresh=connectOk;return {pages:missing?[]:[{id:'P',ok:connectOk,error:connectOk?'':'no perm'}]};}
    if(!fresh)throw new Error('Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.');
    return {ok:true};}};
  vm.runInNewContext(part,{S,App:{userToken:user},String,RegExp,Error});return {S,calls};
}
(async()=>{
  let t=make();let r=await t.S.callWithFreshToken('profile',{pageId:'P'});
  assert.equal(r.refreshed,true);assert.deepEqual(t.calls,['profile:P','connect:P','profile:P'],'refresh only that Page, then retry once');
  t=make({stale:false});r=await t.S.callWithFreshToken('profile',{pageId:'P'});assert.equal(r.refreshed,false);assert.deepEqual(t.calls,['profile:P'],'no extra calls when the token is fine');
  t=make({missing:true});await assert.rejects(t.S.callWithFreshToken('profile',{pageId:'P'}),/không còn quản lý Page này/);
  t=make({connectOk:false});await assert.rejects(t.S.callWithFreshToken('profile',{pageId:'P'}),/Không làm mới được token Page: no perm/);
  t=make({user:''});await assert.rejects(t.S.callWithFreshToken('profile',{pageId:'P'}),/Đăng nhập Facebook lại/);
  const other=make();other.S.call=async()=>{throw new Error('Thiếu action.')};await assert.rejects(other.S.callWithFreshToken('profile',{pageId:'P'}),/Thiếu action/,'other errors are not retried');
  assert.ok(make().S.tokenExpired({message:'(#190) Error validating access token: Session has expired'}));
  assert.match(fs.readFileSync(__dirname+'/../../js/bot.js','utf8'),/S\.callWithFreshToken\('profile'/,'menu save uses the refreshing call');
  console.log('PASS: invalidated server Page token refreshed via connect with the current Facebook login and the menu save retried once; clear errors when the account no longer manages the Page or is logged out; other errors not retried.');
})().catch(e=>{console.error(e);process.exitCode=1;});
