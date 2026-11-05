const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{parseHTML}=require('linkedom');
const repo=path.join(__dirname,'../..'),P=require('../chatgpt-connector/protocol.js'),core=fs.readFileSync(path.join(repo,'js/core.js'),'utf8');
const localInput=at=>new Date(at-new Date(at).getTimezoneOffset()*60000).toISOString().slice(0,16);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(draft={},lateDraft=null){
  const {document}=parseHTML('<html><body><main id="root"></main></body></html>');
  const create=document.createElement.bind(document);document.createElement=tag=>{
    const el=create(tag);if(tag==='input')Object.defineProperty(el,'files',{value:[],writable:true});
    if(tag==='select')Object.defineProperty(el,'value',{get(){return [...el.querySelectorAll('option')].find(o=>o.selected)?.value||el.querySelector('option')?.value||'';},set(value){for(const o of el.querySelectorAll('option'))o.selected=o.value===value;}});
    return el;
  };
  const pages=[{id:'p1',name:'Page One'},{id:'p2',name:'Page Two'}];let selected=pages,id=0;
  const data={postDraftV1:structuredClone(draft),fbScheduleQueueV1:[]},published=[];
  const App={pages,tabs:{},selected:()=>selected,pageById:id=>pages.find(p=>p.id===id),isSelected:id=>selected.some(p=>p.id===id),setSelected:ids=>{selected=pages.filter(p=>ids.includes(p.id));},show:route=>{assert.equal(route,'planner');},tab:(id,tab)=>App.tabs[id]=tab,ai:{open(){}},publish:async(...args)=>{published.push(args);return {id:'mock-post'};}};
  const ctx=vm.createContext({App,document,window:{},Date,MetaAIProtocol:P,norm:s=>String(s||'').toLowerCase(),initials:name=>(name||'?').slice(0,2),toLocalInput:at=>at?new Date(at).toISOString().slice(0,16):'',fmtTime:at=>String(at),uid:prefix=>prefix+'-'+(++id),toast(){},icon:()=>document.createElement('span'),empty:()=>document.createElement('span'),fileToDataUrl:async file=>file.data,DB:{get:async(key,fallback)=>key==='postDraftV1'&&lateDraft?lateDraft:structuredClone(data[key]??fallback),set:async(key,value)=>{data[key]=structuredClone(value);}}});
  vm.runInContext(core.slice(core.indexOf('App.NAV ='),core.indexOf('// ── Tiện ích DOM')),ctx);
  vm.runInContext(core.slice(core.indexOf('const $ ='),core.indexOf('// replaceChildren/append')),ctx);
  vm.runInContext(core.slice(core.indexOf('App.pageAvatarUrl ='),core.indexOf('// Ảnh khách Messenger')),ctx);
  App.pageTag=page=>ctx.h('span',{textContent:page.name});
  vm.runInContext(fs.readFileSync(path.join(repo,'js/lib/pure.js'),'utf8'),ctx);ctx.Pure=ctx.window.Pure;
  vm.runInContext(fs.readFileSync(path.join(repo,'js/posting.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(repo,'js/planner.js'),'utf8'),ctx);
  App.tabs.planner.mount(document.getElementById('root'));
  return {App,ctx,document,data,published,pages,$:id=>document.getElementById(id)};
}
(async()=>{
  const at=localInput(Date.now()+7200000),image='data:image/png;base64,YQ==';
  const a=setup({text:'Legacy draft',image,at,pageId:'p1'});await flush();
  assert.equal(a.App.tabs.post,undefined);assert.ok(!a.App.NAV.publishing[1].some(([id])=>id==='post'));
  assert.equal(a.$('poText').value,'Legacy draft');assert.equal(a.$('poPreview').querySelector('img').src,image);assert.equal(a.$('poComposer').hidden,true);assert.equal(a.$('plCompose').textContent,'Tiếp tục bản nháp');
  a.App.setSelected(['p2']);a.App.posting.open();assert.equal(a.$('poComposer').hidden,false);assert.ok(a.$('poTitle').textContent.includes('Page One'));
  await a.$('poToQueue').onclick();assert.equal(a.data.fbScheduleQueueV1.length,1);assert.equal(a.data.fbScheduleQueueV1[0].pageKey,'p1');assert.equal(a.data.fbScheduleQueueV1[0].imageData,image);assert.equal(a.data.postDraftV1.text,'Legacy draft');assert.equal(a.published.length,0,'saving drafts never publishes');
  await a.$('poGo').onclick();assert.equal(a.published.length,1,a.$('poLog').textContent);assert.equal(a.published[0][0].id,'p1');assert.equal(a.published[0][2],image);assert.equal(a.published[0][3],Math.floor(new Date(at).getTime()/1000));
  a.$('poAt').value=localInput(Date.now()+60000);await a.$('poGo').onclick();assert.equal(a.published.length,1,a.$('poLog').textContent);assert.ok(a.$('poLog').textContent.includes('10 phút'));
  await a.App.posting.applyAI({pageId:'p2',text:'Assigned AI post',imageData:image});assert.equal(a.data.postDraftV1.pageId,'p2');assert.equal(a.data.postDraftV1.text,'Assigned AI post');
  const b=setup();await flush();b.App.posting.open();b.$('poText').value='Manual draft for both Pages';await b.$('poText').oninput();
  let resolveImage;b.ctx.fileToDataUrl=()=>new Promise(resolve=>{resolveImage=resolve;});b.$('poImage').files=[{name:'photo.png'}];b.$('poImage').onchange();
  const saving=b.$('poToQueue').onclick();await b.$('poToQueue').onclick();assert.equal(b.data.fbScheduleQueueV1.length,0);resolveImage(image);await saving;await flush();
  assert.equal(b.data.fbScheduleQueueV1.length,2);assert.ok(b.data.fbScheduleQueueV1.every(post=>post.imageData===image&&post.status==='draft'));assert.equal(b.data.postDraftV1.image,image);assert.equal(b.published.length,0);
  let resumePublish;const blocked=new Promise(resolve=>{resumePublish=resolve;});b.App.publish=async(...args)=>{b.published.push(args);if(b.published.length===1)await blocked;return {id:'mock'};};
  const publishing=b.$('poGo').onclick();await b.$('poGo').onclick();await flush();b.App.setSelected(['p1']);resumePublish();await publishing;
  assert.deepEqual(b.published.map(args=>args[0].id),['p1','p2']);assert.ok(b.published.every(args=>args[3]===0),'empty time publishes now');
  let restore;const late=new Promise(resolve=>{restore=resolve;});const c=setup({},late);c.$('poText').value='Typing before old restore';await c.$('poText').oninput();restore({text:'Old value',image});await flush();assert.equal(c.$('poText').value,'Typing before old restore');
  console.log('PASS: manual composer merged into planner; old draft/image/time/Page restored; page assignment preserved across filters; drafts do not publish; delayed image saved for both Pages; no duplicate sends; publishing uses target snapshot; scheduling lead time checked; late restore preserves new edits.');
})().catch(error=>{console.error(error);process.exitCode=1;});
