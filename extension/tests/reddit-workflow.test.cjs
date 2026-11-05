const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'../chatgpt-connector'),P=require(path.join(base,'protocol.js'));
const refs=[{url:'https://www.reddit.com/r/marketing/comments/test_a/source/?utm_source=share',title:'Reference'}];
const input=P.validate({items:[{key:'one',pageId:'p1',brief:'OLD CUSTOM PROMPT',imagePrompt:'OLD IMAGE PROMPT'}],images:true});
assert.equal(input.items[0].brief,P.POST_PROMPT);assert.equal(input.workflow,P.WORKFLOW);
const prompt=P.prompt(input);assert.ok(prompt.includes(P.POST_PROMPT));assert.ok(!prompt.includes('OLD CUSTOM PROMPT'));
assert.ok(prompt.includes('cấu trúc và độ dài'));assert.ok(prompt.includes('có tiêu đề hay không'));
assert.ok(!prompt.includes('100–180'));assert.ok(!prompt.includes('2–3 hashtag'));
assert.throws(()=>P.prompt({...input,items:[...input.items,...input.items]}),/đúng một bài/);
assert.throws(()=>P.parse(JSON.stringify({posts:[{key:'one',text:'No source'}]}),input),/liên kết/);
assert.equal(P.sources([{url:'https://reddit.com.evil.test/r/a/comments/x'},{url:'javascript:alert(1)'},{url:'https://reddit.com/r/marketing/'}]).length,0);
const post=P.parse(JSON.stringify({posts:[{key:'one',topicTitle:'New angle',text:'Useful article #Marketing #NoiDung',sources:refs}]}),input)[0];
assert.equal(post.sources[0].url,'https://www.reddit.com/r/marketing/comments/test_a/source/');
assert.ok(!post.text.includes('reddit.com'));const image=P.imagePrompt({...post,imagePrompt:'OLD IMAGE PROMPT'});
for(const value of [P.IMAGE_PROMPT,'5:4','0899779488','DƯỚI 25%','chính sách Facebook',post.text])assert.ok(image.includes(value));
assert.ok(!image.includes('OLD IMAGE PROMPT'));assert.ok(P.sourceIssue('{"error":"reddit_unavailable"}'));
assert.ok(image.includes('Tự quyết định có thêm tiêu đề hay không'));assert.ok(!image.includes('ít nhất 8%'));
let listener,session={},local={marketingHistoryV1:{p1:[{key:'older',topicTitle:'Email marketing',text:'Previous article about email marketing',createdAt:1}],p2:[{key:'other',text:'Another Page only',createdAt:1}]}},id=10;
const copy=x=>x===undefined?undefined:structuredClone(x),storage=store=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,copy(store[k])])),set:async values=>Object.assign(store,copy(values)),remove:async key=>{delete store[key];}});
const chrome={storage:{local:storage(local),session:storage(session)},runtime:{id:'studio',getURL:file=>'chrome-extension://studio/'+file,onMessage:{addListener(fn){listener=fn;}}},tabs:{create:async()=>({id:++id}),onRemoved:{addListener(){}}},action:{onClicked:{addListener(){}}}};
const ctx=vm.createContext({chrome,URL,crypto:require('node:crypto').webcrypto,importScripts:(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),ctx))});
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),ctx);
const panel={id:'studio',url:chrome.runtime.getURL('sidepanel.html')},web={url:'https://vanxharu.github.io/quan-ly-page/',tab:{id:1}},send=(m,s=panel)=>new Promise(resolve=>listener(m,s,resolve));
(async()=>{
  await send({type:'CATALOG_SYNC',payload:{pages:[{id:'p1',name:'Marketing Page',topics:[{postPrompt:'DEPRECATED',imagePrompt:'DEPRECATED'}],recentPosts:[{key:'web',topicTitle:'SEO',text:'Previous SEO article from web',createdAt:2}]}]}},web);
  assert.equal(local.pageCatalog.pages[0].topics,undefined,'old Page prompts cannot override common workflow');
  const generated=await send({type:'PANEL_GENERATE',payload:{items:[{key:'one',pageId:'p1'},{key:'two',pageId:'p1'}],images:true}});assert.equal(generated.ok,true);
  const gpt={url:'https://chatgpt.com/',tab:{id:session.job.gptTab}},g=m=>send({id:session.job.id,nonce:session.job.nonce,...m},gpt);
  let claim=await g({type:'CLAIM',agentVersion:'2.2.2'});assert.equal(claim.job.input.workflow,P.WORKFLOW);
  assert.deepEqual(claim.job.input.items[0].recentPosts.map(x=>x.topicTitle),['SEO','Email marketing']);
  assert.ok(!P.prompt(claim.job.input).includes('Another Page only'));
  await g({type:'START'});
  for(const [key,topicTitle] of [['one','Customer research'],['two','Landing pages']]){
    const text=JSON.stringify({posts:[{key,topicTitle,text:'Article about '+topicTitle+' #Marketing #KinhDoanh',sources:refs}]});
    assert.equal((await g({type:'TEXT_RESULT',key,text})).ok,true);
    assert.equal(local.marketingHistoryV1.p1[0].topicTitle,topicTitle,'history saved before image');
    await g({type:'IMAGE_RESULT',key,data:'data:image/jpeg;base64,YQ=='});await g({type:'COMMIT_POST',key});
    const next=await g({type:'NEXT_ITEM',key});
    if(next.input){assert.equal(next.input.workflow,P.WORKFLOW);assert.ok(P.prompt(next.input).includes('Customer research'),'article 2 sees article 1');}
  }
  await g({type:'DONE'});assert.equal(local.panelJob.status,'done');
  assert.equal(local.marketingHistoryV1.p2[0].text,'Another Page only');
  session.job=null;local.panelJob.posts.forEach(post=>post.transferredAt=1);
  const again=await send({type:'PANEL_GENERATE',payload:{items:[{key:'three',pageId:'p1'}],images:false}});assert.equal(again.ok,true);
  claim=await send({type:'CLAIM',agentVersion:'2.2.2'},{url:'https://chatgpt.com/',tab:{id:session.job.gptTab}});
  assert.ok(claim.job.input.items[0].recentPosts.some(x=>x.topicTitle==='Landing pages'),'history survives a new session');
  assert.ok(local.panelJob.input.items[0].brief===P.POST_PROMPT);
  console.log('PASS: one common prompt; old custom prompts ignored; Reddit source validation and separate metadata; shared image prompt; Page-specific durable history across steps and sessions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
