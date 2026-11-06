const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/../../js/core.js','utf8'),section=source.slice(source.indexOf('const PIC_TTL'),source.indexOf('// Dòng Page nhỏ'));
const psid='900000000123456',uid='100000000123456',page={id:'10',access_token:'not-forwarded'},photo='https://scontent.test.fbcdn.net/customer.jpg';
function harness(mode){
  const data={},calls=[],native=[];const App={GRAPH:'https://graph.facebook.com/v25.0',lookupCustomerProfile:async target=>{native.push(target);throw Error('No public identity');}},DB={get:async(k,f)=>structuredClone(data[k]||f),set:async(k,v)=>data[k]=structuredClone(v)};
  const api=async(path,p,method,token)=>{calls.push({path,p,method});assert.equal(token,page.access_token);
    if(method==='POST')return p.batch.map(()=>({code:200,body:'{}'}));
    if(path.includes('/picture'))return {data:{is_silhouette:!(mode==='sender'&&path.includes('/'+uid+'/')),url:photo}};
    if(mode==='partial'&&p.fields==='id,link,picture.width(128).height(128)')throw Error('No permission for link');
    if(mode==='partial'&&p.fields==='id,picture.width(128).height(128)')return {id:psid,picture:{data:{is_silhouette:false,url:photo}}};
    if(path==='/thread-one'){
      if(mode==='thread'&&p.fields==='id,participants,senders,link')throw Error('Link field unavailable');
      const participants={data:[{id:page.id},{id:psid}]};
      if(p.fields==='id,participants')return {id:'thread-one',participants};
      if(p.fields==='id,senders')return {id:'thread-one',senders:{data:[{id:uid}]}};
      return {id:'thread-one',participants};
    }
    if(mode==='thread'&&path==='/'+uid&&p.fields==='profile_pic')return {id:uid,profile_pic:photo};
    return {};
  };
  const pool=async(items,n,fn)=>{for(const item of items)await fn(item);};vm.runInNewContext(section,{App,DB,api,pool,URL,Date,Map,Set,Promise,console:{warn(){}}});
  const note=messages=>App.noteCustomerConversation(page,{id:'thread-one',participants:{data:[{id:page.id},{id:psid}]},messages:{data:messages.map(id=>({from:{id}}))}},{id:psid});
  return {App,data,calls,native,note};
}
(async()=>{
  const partial=harness('partial');assert.equal((await partial.App.customerPics(page,[psid])).get(psid),photo,'denied link field does not discard permitted picture');
  const sender=harness('sender');assert.equal((await sender.App.customerPics(page,[psid])).get(psid),'');const before=sender.calls.length;
  assert.equal(sender.note([uid]),true);assert.equal(sender.note([page.id]),false,'list refresh must preserve richer sender evidence');
  assert.equal((await sender.App.customerPics(page,[psid])).get(psid),photo,'fresh message evidence overrides negative photo cooldown immediately');assert.ok(sender.calls.length>before);assert.ok(!JSON.stringify(sender.data).includes(page.access_token));
  const thread=harness('thread');thread.note([page.id]);assert.equal((await thread.App.customerPics(page,[psid])).get(psid),photo,'unsupported combined thread field still allows sender-ID avatar');assert.ok(thread.calls.some(c=>c.p.fields==='id,senders'));
  const ambiguous=harness('sender');ambiguous.note([uid,'100000000999999']);assert.equal((await ambiguous.App.customerPics(page,[psid])).get(psid),'','multiple possible senders never produce a guessed identity');
  console.log('PASS: independent permitted fields, rich sender evidence survives list refresh, new evidence bypasses negative cache, alternate exact-thread sender pictures, no name guessing or token persistence.');
})().catch(e=>{console.error(e);process.exitCode=1});
