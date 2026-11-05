const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const base=path.join(__dirname,'../chatgpt-connector'),P=require(path.join(base,'protocol.js'));
const {window,document}=parseHTML('<html><body><main id="output"></main><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button" aria-label="Send prompt"></button></body></html>');
document.location={origin:'https://chatgpt.com'};
const editor=document.getElementById('prompt-textarea'),send=document.querySelector('button');
editor.getClientRects=send.getClientRects=()=>[1];editor.focus=()=>{};
document.execCommand=(_,__,text)=>{editor.textContent=text;};
let stored,listener,clock=1000,pendingReply=null,resolveDone;
const completed=new Promise(resolve=>{resolveDone=resolve;}),clicks=[],events=[];
const invoke=m=>new Promise(resolve=>listener(m,{url:'https://chatgpt.com/',frameId:3},resolve));
const chrome={
  storage:{session:{get:async()=>({job:structuredClone(stored)}),set:async({job})=>{stored=structuredClone(job);}},local:{set:async values=>{if(['done','error'].includes(values.panelJob?.status))resolveDone();},get:async()=>({})}},
  tabs:{onRemoved:{addListener(){}}},
  runtime:{getURL:file=>'chrome-extension://studio-test/'+file,onMessage:{addListener(fn){listener=fn;}},sendMessage:m=>{events.push(m);return invoke(m);}}
};
const bg=vm.createContext({chrome,URL,crypto:require('node:crypto').webcrypto,importScripts:(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),bg))});
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),bg);
stored={id:'ai-response-regression',nonce:'private-test-nonce',status:'opening',mode:'panel',transport:'embedded',completedKeys:[],posts:[],input:{workflow:P.WORKFLOW,items:[{key:'one',pageId:'p1',pageName:'Page One',brief:'Real facts one'},{key:'two',pageId:'p2',pageName:'Page Two',brief:'Real facts two'}],images:true}};
let turnNumber=0;
send.click=()=>{
  assert.equal(pendingReply,null,'do not send the next prompt before this answer finishes');
  const prompt=editor.textContent,key=stored.input.items[stored.currentIndex||0].key,image=prompt.includes('Hãy TẠO MỘT ẢNH');
  if(key==='two'&&!image){assert.ok(stored.completedKeys.includes('one'));assert.ok(stored.posts[0].imageData);}
  clicks.push((image?'image:':'text:')+key);editor.textContent='';
  const output=document.getElementById('output'),n=++turnNumber,user=document.createElement('div');
  user.setAttribute('data-content-search-unit-key','turn-'+n+':user');user.textContent=prompt;output.append(user);
  const assistant=document.createElement('div');assistant.setAttribute('data-content-search-unit-key','turn-'+n+':assistant');output.append(assistant);
  if(image){
    const img=document.createElement('img');img.src='https://chatgpt.com/backend-api/estuary/content?id='+key;
    Object.defineProperties(img,{naturalWidth:{value:1080},naturalHeight:{value:1350}});assistant.append(img);
  }else{
    // No Stop button, a stable introduction, then incomplete JSON in a sibling block.
    // The old agent sent the introduction to TEXT_RESULT after six seconds and failed.
    assistant.innerHTML='<div class="markdown"><p>Đang chuẩn bị bài viết theo chủ đề của Page.</p></div>';
    pendingReply={assistant,key,startedAt:clock,partial:false,complete:false};
  }
};
function advance(ms){
  clock+=ms;if(clock>4000000)throw Error('Regression flow did not finish');
  if(!pendingReply)return;
  const {assistant,key,startedAt}=pendingReply,elapsed=clock-startedAt;
  if(!pendingReply.partial&&elapsed>=9000){
    assert.equal(stored.posts.some(post=>post.key===key),false,'introductory text must not be saved as the post');
    const body=document.createElement('div');body.className='markdown';body.textContent='{"posts":[{"key":"'+key+'","text":"Bài còn đang tạo';assistant.append(body);pendingReply.partial=true;
  }
  // Article 1 pauses for over twenty minutes; waiting must have no deadline.
  if(elapsed>=(key==='one'?21*60*1000:19000)){
    assert.equal(stored.posts.some(post=>post.key===key),false,'incomplete JSON must not be saved');
    const body=assistant.querySelectorAll('.markdown')[1];
    const answer=JSON.stringify({posts:[{key,sources:[{url:'https://www.reddit.com/r/marketing/comments/fixture/source/'}],text:'BÀI '+key+'\n\nNội dung đúng Page, đúng dữ liệu được cung cấp. Liên hệ: 0899779488\n#ThongTin #ChuDe',imagePrompt:'Ảnh ngang 5:4, chữ dưới 25%'}]});
    const midpoint=answer.indexOf(',"imagePrompt"');
    body.textContent=answer.slice(0,midpoint);
    const sibling=document.createElement('div');sibling.className='markdown';sibling.textContent=answer.slice(midpoint);assistant.append(sibling);
    pendingReply=null;
  }
}
let frameListener;
const parent={postMessage:m=>{if(m.type==='FRAME_READY')queueMicrotask(()=>frameListener({source:parent,origin:'null',data:{source:'META_STUDIO_PANEL',type:'FRAME_RUN',job:{id:stored.id,nonce:stored.nonce,status:'opening',input:{workflow:P.WORKFLOW,items:[stored.input.items[0]],images:true},index:0,total:2}}}));}};
const ctx={window:{parent,addEventListener:(type,fn)=>{if(type==='message')frameListener=fn;}},document,location:{origin:'https://chatgpt.com',href:'https://chatgpt.com/?meta_studio_job='+stored.id,ancestorOrigins:['chrome-extension://studio-test'],pathname:'/c/test'},MetaAIProtocol:P,chrome,URL,Event:window.Event,InputEvent:window.Event,sessionStorage:{getItem(){},setItem(){}},Date:{now:()=>clock},setInterval(){},clearInterval(){},setTimeout(fn,ms){advance(ms);queueMicrotask(fn);}};
let source=fs.readFileSync(process.env.META_STUDIO_AGENT_SOURCE||path.join(base,'chatgpt-agent.js'),'utf8');
const a=source.indexOf('  async function imageData('),b=source.indexOf('  async function run()',a);
source=source.slice(0,a)+"  async function imageData(){return 'data:image/jpeg;base64,YQ==';}\n"+source.slice(b);
vm.runInNewContext(source,ctx);
const failTimer=setTimeout(()=>{console.error('FAIL: completion not observed');process.exitCode=1;},15000);
completed.then(()=>{
  clearTimeout(failTimer);assert.equal(stored.status,'done',stored.error);
  assert.deepEqual(clicks,['text:one','image:one','text:two','image:two']);
  assert.equal(events.filter(event=>event.type==='TEXT_RESULT').length,2);
  assert.equal(stored.posts.length,2);assert.equal(stored.completedKeys.length,2);
  assert.ok(stored.posts.every(post=>post.imageData&&post.text.includes('#ChuDe')));
  assert.deepEqual(stored.posts.map(post=>post.pageId),['p1','p2']);
  assert.ok(clock>21*60*1000,'wait for a result after a long pause');
  console.log('PASS: stable introduction and incomplete JSON do not fail; sibling Markdown JSON assembled; 21 minute pause allowed; one send per step; text1 -> image1 -> durable save -> text2 -> image2 -> save; Page IDs preserved.');
}).catch(error=>{clearTimeout(failTimer);console.error(error);process.exitCode=1;});
