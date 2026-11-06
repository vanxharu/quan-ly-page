const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{parseHTML}=require('linkedom');
const base=__dirname+'/../chatgpt-connector/',version=require(base+'manifest.json').version,origin='https://vanxharu.github.io',url=origin+'/quan-ly-page/?v=2',tick=()=>new Promise(r=>setImmediate(r));
async function workerRecovery(){
  let installed,startup,listener,now=Date.now();const reloads=[],probes=[],session={},local={panelJob:{id:'saved',status:'done',posts:[{key:'one',text:'Saved article'}]},pendingTransfer:{id:'transfer',posts:[{text:'Keep me'}]},studioSettings:{postPrompt:'My prompt'}};
  const before=structuredClone(local),store=data=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async value=>Object.assign(data,value)});
  const tabs=[{id:1,url,status:'complete'},{id:2,url,status:'complete'},{id:3,url,status:'complete'},{id:4,url,status:'loading'},{id:5,url:'https://chatgpt.com/',status:'complete'}];
  const chrome={runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p,onMessage:{addListener:f=>listener=f},onInstalled:{addListener:f=>installed=f},onStartup:{addListener:f=>startup=f}},storage:{local:store(local),session:store(session)},action:{onClicked:{addListener(){}}},tabs:{query:async options=>{assert.equal(options.url,origin+'/quan-ly-page/*');return tabs;},sendMessage:async(id,m)=>{assert.equal(m.type,'BRIDGE_PING');probes.push(id);if(id===1)return {ok:true,version};if(id===2)throw Error('Could not establish connection. Receiving end does not exist.');return undefined;},reload:async(id,options)=>{assert.equal(options.bypassCache,true);reloads.push(id);},onRemoved:{addListener(){}}}};
  const ctx=vm.createContext({chrome,URL,Date:class extends Date{static now(){return now;}},crypto:require('crypto').webcrypto,setTimeout,clearTimeout,importScripts:(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(base+name,'utf8'),ctx))});vm.runInContext(fs.readFileSync(base+'background.js','utf8'),ctx);
  await installed({reason:'update'});assert.deepEqual(reloads.sort(),[2,3],'reload disconnected and legacy web bridge only');assert.deepEqual(probes.sort(),[1,2,3],'GPT and loading tabs untouched');assert.deepEqual(local,before,'articles, transfer and settings retained');
  now+=11000;await startup();assert.equal(reloads.length,2,'persisted cooldown prevents reload loops');
  tabs[3].status='complete';await new Promise(r=>listener({type:'PANEL_STATUS'},{id:'ext',url:'chrome-extension://ext/sidepanel.html'},r));await tick();assert.ok(reloads.includes(4),'opening panel also repairs a tab that was loading during update');
}
async function bridgeFailure(){
  let windowListener,runtimeListener,calls=0;const replies=[],window={postMessage:m=>replies.push(m),addEventListener:(_,fn)=>windowListener=fn},chrome={runtime:{sendMessage:async()=>{calls++;throw Error('Extension context invalidated.');},onMessage:{addListener:fn=>runtimeListener=fn}}};
  vm.runInNewContext(fs.readFileSync(base+'web-bridge.js','utf8'),{window,chrome,location:{origin,pathname:'/quan-ly-page/'},document:{addEventListener(){}},performance});
  const send=(id,from=origin)=>windowListener({source:window,origin:from,data:{source:'META_ASSISTANT_AI_V106',type:'STATUS',id}});
  await send('one','https://evil.example');assert.equal(calls,0);await send('two');await send('three');assert.equal(calls,1,'invalid bridge stops calling unloaded runtime');assert.equal(replies.at(-1).code,'BRIDGE_DISCONNECTED');
  let answer;runtimeListener({channel:'META_AI_EVENT',type:'BRIDGE_PING'},null,r=>answer=r);assert.equal(answer.ok,false);assert.equal(answer.version,version);
}
async function webRecovery(){
  const {document}=parseHTML('<html><body></body></html>'),listeners={},intervals=[],messages=[],notices=[];let broken=true;
  const window={addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent(){},postMessage:m=>{messages.push(m);queueMicrotask(()=>listeners.message({source:window,origin,data:{source:'META_AI_CONNECTOR_V106',type:'REPLY',id:m.id,...(broken?{ok:false,code:'BRIDGE_DISCONNECTED',error:'Extension disconnected'}:{ok:true,profiles:[]})}}));}};
  const App={pages:[{id:'1'}],onLogin:[],onPageChange:[],selected:()=>[],pageAvatarUrl:()=>'',tabs:{}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../../js/ai-writer.js','utf8'),{App,window,document,location:{origin},URL,MetaAIProtocol:require(base+'protocol.js'),uid:()=>String(messages.length),DB:{get:async(k,f)=>f},setTimeout:()=>1,clearTimeout(){},setInterval:fn=>intervals.push(fn),Event:class{},toast:m=>notices.push(m),setDark(){}});
  await App.onLogin[0]();await tick();assert.equal(notices.length,1,'single reconnect notice replaces repeated import failure');const count=messages.length;
  for(let n=0;n<3;n++){intervals[0]();await tick();}assert.equal(messages.length,count,'periodic imports pause while disconnected');
  await assert.rejects(App.lookupKnownCustomerProfiles(['100000000123456']),e=>e.code==='BRIDGE_DISCONNECTED');assert.equal(messages.length,count);
  broken=false;await listeners.message({source:window,origin,data:{source:'META_AI_CONNECTOR_V106',type:'BRIDGE_READY',version}});await tick();assert.ok(messages.length>count,'fresh bridge resumes import');assert.deepEqual([...await App.lookupKnownCustomerProfiles(['100000000123456'])],[],'avatar requests resume too');
}
(async()=>{await workerRecovery();await bridgeFailure();await webRecovery();console.log('PASS: update/startup/panel repair disconnected Meta Assistant tabs only; healthy GPT and web untouched; drafts retained; reload loop guarded; invalid-context requests paused; import and avatars resume on new bridge.');})().catch(e=>{console.error(e);process.exitCode=1});
