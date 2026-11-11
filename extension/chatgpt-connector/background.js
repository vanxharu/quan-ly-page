importScripts('protocol.js','embed-rules.js','studio-storage.js');
const P=MetaAIProtocol,WORKER_VERSION='2.5.3';
let updatingExtension=false;

// Sau khi nạp lại tiện ích, content script ở tab web cũ đã bị Chrome vô hiệu hoá.
// Chỉ sửa tab Meta Assistant không còn cầu nối; không đụng tab GPT hoặc bản nháp.
const bridgeRepairs=new Map(),bridgeChecks=new Map();
async function repairWebConnections(){
  if(typeof chrome.tabs.query!=='function'||typeof chrome.tabs.reload!=='function')return;
  const tabs=await chrome.tabs.query({url:'https://vanxharu.github.io/quan-ly-page/*'});
  await Promise.all(tabs.filter(tab=>Number.isInteger(tab.id)&&P.website(tab.url)&&tab.status!=='loading').map(tab=>{
    if(bridgeRepairs.has(tab.id))return bridgeRepairs.get(tab.id);
    if(Date.now()-(bridgeChecks.get(tab.id)||0)<10000)return;
    bridgeChecks.set(tab.id,Date.now());
    const task=(async()=>{
      let timer,healthy=false;
      try{const answer=await Promise.race([chrome.tabs.sendMessage(tab.id,{channel:'META_AI_EVENT',type:'BRIDGE_PING'}),new Promise(resolve=>timer=setTimeout(()=>resolve(null),2000))]);healthy=answer?.ok===true&&answer.version===WORKER_VERSION;}catch{}finally{clearTimeout(timer);}
      if(healthy)return;
      const key='webBridgeReloadV1:'+tab.id,previous=(await StudioStorage.session.get(key))[key];
      if(previous&&previous.url===tab.url&&Date.now()-previous.at<60000)return;
      await StudioStorage.session.set({[key]:{url:tab.url,at:Date.now()}});
      await chrome.tabs.reload(tab.id,{bypassCache:true});
    })().catch(()=>{}).finally(()=>bridgeRepairs.delete(tab.id));
    bridgeRepairs.set(tab.id,task);return task;
  }));
}
chrome.runtime.onInstalled?.addListener(()=>repairWebConnections().catch(()=>{}));
chrome.runtime.onStartup?.addListener(()=>repairWebConnections().catch(()=>{}));

const callUpdater=(action,extra={})=>new Promise((resolve,reject)=>{
  if(typeof chrome.runtime.sendNativeMessage!=='function')return reject(Error('Cần cài bộ cập nhật Windows và Tải lại tiện ích một lần.'));
  chrome.runtime.sendNativeMessage('com.metaassistant.updater',{action,...extra},result=>{
    if(chrome.runtime.lastError)return reject(Error('Kết nối Windows: '+String(chrome.runtime.lastError.message||'Chưa nhận phản hồi.').slice(0,300)));
    if(!result?.ok)return reject(Error(result?.error||'Không cập nhật được tiện ích.'));
    resolve(result);
  });
});
const publicProfileRequests=new Map(),publicProfileFailures=new Map();let profileConnectorUnavailableUntil=0,publicProfileWrites=Promise.resolve();
function profileTarget(value){
  const text=String(value||'').trim();if(/^\d{5,30}$/.test(text))return text;
  const url=new URL(text);if(url.protocol!=='https:'||url.username||url.password||url.port||!['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname))throw Error('Chỉ dùng link Facebook công khai.');
  const slug=url.pathname.replace(/^\/+|\/+$/g,'');
  if(/^app_scoped_user_id\/\d{5,30}$/.test(slug))return 'https://www.facebook.com/'+slug+'/' ;
  if(slug==='profile.php'){const id=url.searchParams.get('id');if(!/^\d{5,30}$/.test(id||''))throw Error('UID không hợp lệ.');return id;}
  if(!/^[a-zA-Z0-9.]{3,100}$/.test(slug)||['login','checkpoint','help','privacy','settings','photo.php','l.php','home.php','watch','reel','groups','pages','recover','dialog','share'].includes(slug.toLowerCase()))throw Error('Cần link trang cá nhân.');
  return 'https://www.facebook.com/'+slug;
}
const inlineAvatar=value=>typeof value==='string'&&value.length<=200000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)?value:'';
function cleanPublicProfile(result,target){
  const avatar=new URL(result.avatar);if(!/^\d{5,30}$/.test(result.uid)||avatar.protocol!=='https:'||!avatar.hostname.endsWith('.fbcdn.net')||avatar.username||avatar.password||/(?:[?&])(access_token|token|authorization)=/i.test(avatar.search))throw Error('Danh tính hoặc ảnh công khai không hợp lệ.');
  return {...(result.sourceId===target&&/^\d{5,30}$/.test(target)?{sourceId:target}:{}),uid:result.uid,name:String(result.name||'').slice(0,200),profileUrl:profileTarget(result.profileUrl),avatar:avatar.href,...(inlineAvatar(result.avatarData)?{avatarData:result.avatarData}:{})};
}
let localAvatarSnapshot=null,localAvatarAt=0,localAvatarRead;
async function localCustomerProfiles(targets){
  if(!localAvatarSnapshot||Date.now()-localAvatarAt>(Object.keys(localAvatarSnapshot).length?30000:1000)){
    if(!localAvatarRead)localAvatarRead=(async()=>{try{if(typeof fetch!=='function')return {};const response=await fetch(chrome.runtime.getURL('customer-avatar-cache.json'),{cache:'no-store'});return response.ok?await response.json():{};}catch{return {};}})().then(value=>{localAvatarSnapshot=value;localAvatarAt=Date.now();return value;}).finally(()=>{localAvatarRead=null;});
    await localAvatarRead;
  }
  const profiles=[];for(const target of [...new Set(targets)].slice(0,50)){const raw=localAvatarSnapshot?.[target];if(!raw||!Number.isFinite(Number(raw.cachedAt))||Date.now()-Number(raw.cachedAt)>3*864e5||Number(raw.cachedAt)>Date.now()+300e3)continue;try{const profile=cleanPublicProfile(raw,target);if(inlineAvatar(profile.avatarData)&&(profile.uid===target||profile.sourceId===target||!/^\d+$/.test(target)))profiles.push(profile);}catch{}}
  return profiles;
}
async function lookupPublicProfile(payload){
  const target=profileTarget(payload?.profile),key='profile:'+target;
  if(!payload?.force){const local=await localCustomerProfiles([target]);if(local.length)return local[0];}
  const failed=publicProfileFailures.get(key);if(!payload?.force&&failed&&Date.now()-failed.at<3600e3)throw Error(failed.error);
  if(publicProfileRequests.has(key))return publicProfileRequests.get(key);
  const request=(async()=>{
    const cached=(await StudioStorage.local.get('publicProfileCacheV1')).publicProfileCacheV1||{},previous=cached[key];
    if(!payload?.force&&previous&&Date.now()-previous.at<(previous.ok?864e5:3600e3)){if(!previous.ok)throw Error(previous.error);return previous.profile;}
    if(Date.now()<profileConnectorUnavailableUntil)throw Error('Cần cập nhật bộ kết nối Windows để đọc UID từ trang công khai.');
    const result=await new Promise((resolve,reject)=>{
      if(typeof chrome.runtime.sendNativeMessage!=='function')return reject(Error('Chưa cài bộ kết nối Windows.'));
      chrome.runtime.sendNativeMessage('com.metaassistant.updater',{action:'public_profile',profile:target},data=>{if(chrome.runtime.lastError){const reason=String(chrome.runtime.lastError.message||'').slice(0,300);profileConnectorUnavailableUntil=Date.now()+60000;return reject(Error('Kết nối Windows: '+reason));}if(!data?.ok)return reject(Error(data?.error||'Chưa đọc được UID công khai.'));resolve(data);});
    });
    const profile=cleanPublicProfile(result,target);
    // Merge after the request so parallel customer results do not overwrite each other.
    const write=publicProfileWrites.catch(()=>{}).then(async()=>{const current=(await StudioStorage.local.get('publicProfileCacheV1')).publicProfileCacheV1||{};const {avatarData,...metadata}=profile;current[key]={ok:true,at:Date.now(),profile:metadata};const entries=Object.entries(current).sort((a,b)=>b[1].at-a[1].at).slice(0,1000);await StudioStorage.local.set({publicProfileCacheV1:Object.fromEntries(entries)});});publicProfileWrites=write;await write;return profile;
  })();publicProfileRequests.set(key,request);try{const result=await request;publicProfileFailures.delete(key);return result;}catch(error){publicProfileFailures.set(key,{at:Date.now(),error:String(error.message)});if(publicProfileFailures.size>1000)publicProfileFailures.delete(publicProfileFailures.keys().next().value);throw error;}finally{publicProfileRequests.delete(key);}
}
const configureInput=async input=>{input.settings=P.settings((await StudioStorage.local.get('studioSettings')).studioSettings);input.workflow=input.settings.reddit?P.WORKFLOW:'custom-post-v1';for(const item of input.items)item.brief=input.settings.postPrompt;return input;};
const homeFor=async()=>P.settings((await StudioStorage.local.get('studioSettings')).studioSettings).gptHome;
const getJob=async()=> (await StudioStorage.session.get('job')).job || null;
const save=async job=>{await StudioStorage.session.set({job});if(job.mode==='panel')await StudioStorage.local.set({panelJob:job});};
async function attachHistory(input,catalog){
  const history=(await StudioStorage.local.get('marketingHistoryV1')).marketingHistoryV1||{};
  for(const item of input.items){const page=catalog?.pages.find(p=>p.id===item.pageId);item.recentPosts=P.recentPosts([...(history[item.pageId]||[]),...(page?.recentPosts||[]),...(item.recentPosts||[])]);}
}
async function rememberPosts(posts){
  const history=(await StudioStorage.local.get('marketingHistoryV1')).marketingHistoryV1||{};
  for(const post of posts)history[post.pageId]=P.recentPosts([{key:post.key,topicTitle:post.topicTitle,text:post.text,createdAt:Date.now()},...(history[post.pageId]||[])]);
  await StudioStorage.local.set({marketingHistoryV1:history});
}
const inputFor=job=>({items:[job.input.items[job.currentIndex||0]],images:job.input.images,workflow:job.input.workflow,settings:job.input.settings});
async function notify(job,type,extra={}) {if(job.mode==='panel')return;try{await chrome.tabs.sendMessage(job.webTab,{channel:'META_AI_EVENT',type,id:job.id,...extra});}catch{/* Kết quả vẫn giữ trong session để trang khôi phục khi tải lại. */}}
async function finish(job,error='') {
  job.status=error?'error':'done';job.error=error;job.updatedAt=Date.now();await save(job);
  await notify(job,'RESULT',{posts:job.posts||[],error});
}
async function openStudio(tab){
  if(chrome.sidePanel?.open){try{await chrome.sidePanel.open({windowId:tab.windowId});return;}catch{}}
  await chrome.windows.create({url:chrome.runtime.getURL('sidepanel.html'),type:'popup',width:450,height:820});
}
chrome.action?.onClicked.addListener(tab=>{openStudio(tab).catch(()=>{});});
const panelSender=sender=>!!sender.id&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('sidepanel.html');
function safeAvatar(value){try{const url=new URL(String(value||''));if(url.protocol!=='https:'||url.username||url.password)return '';for(const key of ['access_token','token','authorization','auth'])url.searchParams.delete(key);return url.href.slice(0,4000);}catch{return '';}}
function cleanCatalog(payload){
  return {updatedAt:Date.now(),theme:payload?.theme==='dark'?'dark':'light',pages:(Array.isArray(payload?.pages)?payload.pages:[]).slice(0,250).filter(p=>p?.id&&p?.name).map(p=>({id:String(p.id).slice(0,40),name:String(p.name).slice(0,300),avatar:safeAvatar(p.avatar),selected:p.selected===true,recentPosts:P.recentPosts(p.recentPosts)}))};
}
async function startPanel(input,transport='tab',panelId=''){
  if(updatingExtension)throw Error('Tiện ích đang cập nhật. Hãy chờ nạp lại xong.');
  const existing=await getJob();if(existing&&['opening','running'].includes(existing.status))throw Error('Một lượt đang chạy. Chờ xong hoặc bấm Dừng trước.');
  const previous=(await StudioStorage.local.get('panelJob')).panelJob;if(previous?.posts.some(p=>!p.transferredAt))throw Error('Chuyển các bản nháp đang giữ sang web trước khi tạo lượt mới, để không mất bài.');
  const catalog=(await StudioStorage.local.get('pageCatalog')).pageCatalog;
  const validated=await configureInput(P.validate(input));for(const item of validated.items){const page=catalog?.pages.find(p=>p.id===item.pageId);if(!page)throw Error('Page chưa đồng bộ từ website.');item.pageName=page.name;}
  await attachHistory(validated,catalog);
  if(transport==='embedded')await StudioEmbed.prepare();
  const job={id:'ai-'+crypto.randomUUID(),nonce:crypto.randomUUID(),mode:'panel',transport:transport==='embedded'?'embedded':'tab',ownerPanelId:String(panelId).slice(0,100),input:validated,posts:[],completedKeys:[],status:'opening',progress:'Đang mở ChatGPT…',updatedAt:Date.now(),webTab:null,gptTab:null};await save(job);if(previous?.id&&previous.posts.every(p=>p.transferredAt))await StudioStorage.forgetJob(previous.id);
  if(job.transport==='embedded')return {ok:true,id:job.id,runJob:{id:job.id,nonce:job.nonce,input:inputFor(job),index:0,total:job.input.items.length,status:'opening'}};
  try{const tab=await chrome.tabs.create({url:job?.input?.settings?.gptHome||await homeFor(),active:true});job.gptTab=tab.id;await save(job);}catch(e){await finish(job,'Không mở được ChatGPT.');throw e;}return {ok:true,id:job.id};
}
async function transferPanel(keys){
  const live=await getJob(),job=live?.mode==='panel'?live:(await StudioStorage.local.get('panelJob')).panelJob;
  const posts=job?.posts.filter(p=>keys.includes(p.key)&&(job.completedKeys?.includes(p.key)||!['opening','running'].includes(job.status)&&p.text?.trim()));if(!posts?.length)throw Error('Chưa có bài hoàn tất để chuyển.');
  const matches=await chrome.tabs.query({url:'https://vanxharu.github.io/quan-ly-page/*'});let tab=matches[0];if(!tab)tab=await chrome.tabs.create({url:'https://vanxharu.github.io/quan-ly-page/',active:true});
  const transfer={id:crypto.randomUUID(),webTab:tab.id,sourceJobId:job.id,posts:posts.map(post=>({...post,imageRequired:job.input.images===true})),cursor:0,createdAt:Date.now()};const previous=(await StudioStorage.local.get('pendingTransfer')).pendingTransfer;if(previous)throw Error('Đang chờ website nhận lượt chuyển trước. Mở web để hoàn tất.');
  await StudioStorage.local.set({pendingTransfer:transfer});await chrome.tabs.update(tab.id,{active:true});try{await chrome.tabs.sendMessage(tab.id,{channel:'META_AI_EVENT',type:'PANEL_IMPORT_READY'});}catch{}return {ok:true};
}
function transferBatch(transfer){
  if(!transfer)return null;const cursor=transfer.cursor||0,posts=[];let bytes=0;
  for(const post of transfer.posts.slice(cursor)){const size=JSON.stringify(post).length;if(posts.length&&bytes+size>3000000)break;posts.push(post);bytes+=size;}
  return {...transfer,id:cursor?transfer.id+':'+cursor:transfer.id,posts,cursor,total:transfer.posts.length};
}
function panelJobView(job){return job?{...job,posts:(job.posts||[]).map(post=>{const {imageData,...metadata}=post;return {...metadata,hasImage:!!imageData};})}:job;}
async function handle(m,sender) {
  const fromWeb=P.website(sender.url),fromGPT=(()=>{try{return new URL(sender.url).origin==='https://chatgpt.com';}catch{return false;}})();
  if(panelSender(sender)){
    if(m.type==='PANEL_SAVE_SETTINGS'){const job=await getJob();if(updatingExtension||job&&['opening','running'].includes(job.status))throw Error('Chờ lượt tạo hoặc cập nhật hoàn tất trước khi đổi cài đặt.');const settings=P.settings(m.settings);await StudioStorage.local.set({studioSettings:settings});return {ok:true,settings};}
    if(m.type==='PANEL_UPDATE'){
      const job=await getJob();if(updatingExtension)throw Error('Tiện ích đang cập nhật.');
      if(job&&['opening','running'].includes(job.status))throw Error('Chờ GPT tạo xong hoặc dừng lượt tạo trước khi cập nhật.');
      updatingExtension=true;let reload=false;
      try{const result=await callUpdater('update',{runningVersion:WORKER_VERSION,uiVersion:String(m.uiVersion||'')});
        const filesUpdated=typeof result.filesUpdated==='boolean'?result.filesUpdated:!!result.updated;
        const reloadRequired=filesUpdated||result.reloadRequired===true||result.version!==WORKER_VERSION||m.uiVersion!==WORKER_VERSION;
        if(reloadRequired){await StudioStorage.local.set({lastExtensionUpdate:{version:result.version,fromVersion:WORKER_VERSION,at:Date.now(),state:'pending_reload'}});reload=true;setTimeout(()=>chrome.runtime.reload(),600);}
        return {ok:true,updated:filesUpdated||reloadRequired,filesUpdated,reloadRequired,version:result.version,runningVersion:WORKER_VERSION};}
      finally{if(!reload)updatingExtension=false;}
    }
    if(m.type==='PANEL_FRAME_ERROR'){const job=await getJob();if(job?.mode==='panel'&&job.transport==='embedded'&&job.id===m.jobId&&['opening','running'].includes(job.status))await finish(job,String(m.error||'Khung GPT chưa nhận lệnh.').slice(0,500));return {ok:true};}
    if(m.type==='PANEL_PREPARE_EMBED'){await StudioEmbed.prepare();return {ok:true};}
    if(m.type==='PANEL_ATTACH'){const job=await getJob();if(job?.mode==='panel'&&job.transport==='embedded'&&['opening','running'].includes(job.status)&&job.ownerPanelId!==m.panelId){job.status='interrupted';job.progress='Khung GPT đã đóng hoặc tải lại. Các bản nháp đã nhận vẫn được giữ.';await save(job);}return {ok:true};}
    if(m.type==='PANEL_OPEN_GPT'){const job=await getJob();if(job?.gptTab){try{await chrome.tabs.update(job.gptTab,{active:true});return {ok:true};}catch{}}await chrome.tabs.create({url:job?.input?.settings?.gptHome||await homeFor(),active:true});return {ok:true};}
    if(m.type==='PANEL_SWITCH_TO_TAB'){const job=await getJob();if(!job||job.mode!=='panel'||job.transport!=='embedded'||job.status!=='opening'||job.posts.length)throw Error('GPT đã bắt đầu lượt này. Bấm Dừng trước khi đổi cách mở để tránh gửi lặp.');const tab=await chrome.tabs.create({url:job?.input?.settings?.gptHome||await homeFor(),active:true});job.transport='tab';job.gptTab=tab.id;job.frameDocumentId=null;await save(job);return {ok:true};}
    if(m.type==='PANEL_THEME'){const theme=m.theme==='dark'?'dark':'light';await StudioStorage.local.set({studioTheme:theme});for(const tab of await chrome.tabs.query({url:'https://vanxharu.github.io/quan-ly-page/*'})){try{await chrome.tabs.sendMessage(tab.id,{channel:'META_AI_EVENT',type:'THEME_CHANGED',theme});}catch{}}return {ok:true};}
    if(m.type==='PANEL_STATUS'){repairWebConnections().catch(()=>{});const local=await StudioStorage.local.get(['panelJob','pageCatalog','pendingTransfer','studioTheme','marketingHistoryV1','studioSettings']);const live=await getJob();if(local.panelJob&&['opening','running'].includes(local.panelJob.status)&&live?.id!==local.panelJob.id){local.panelJob.status='interrupted';local.panelJob.progress='Lượt tạo đã ngắt khi trình duyệt hoặc tiện ích tải lại. Các bản nháp đã xong vẫn được giữ.';await StudioStorage.local.set({panelJob:local.panelJob});}return {ok:true,version:WORKER_VERSION,...local,panelJob:panelJobView(local.panelJob),pendingTransfer:local.pendingTransfer?{id:local.pendingTransfer.id}:null,externalRunning:!!live&&live.mode!=='panel'&&['opening','running'].includes(live.status)};}
    if(m.type==='PANEL_IMAGE'){const live=await getJob(),job=live?.mode==='panel'?live:(await StudioStorage.local.get('panelJob')).panelJob;const post=job?.posts.find(p=>p.key===m.key);return {ok:true,imageData:post?.imageData||''};}
    if(m.type==='PANEL_GENERATE')return startPanel(m.payload,m.transport,m.panelId);
    if(m.type==='PANEL_CANCEL'){const job=await getJob();if(job&&['opening','running'].includes(job.status)){job.status='cancelled';job.progress='Đã dừng. Các bài đã tạo được giữ trong tiện ích.';await save(job);}return {ok:true};}
    if(m.type==='PANEL_EDIT'){const live=await getJob();const job=live?.mode==='panel'?live:(await StudioStorage.local.get('panelJob')).panelJob;const post=job?.posts.find(p=>p.key===m.key);if(!post)throw Error('Không tìm thấy bài.');post.text=String(m.text||'').slice(0,18000);if(live?.id===job.id)await save(job);else await StudioStorage.local.set({panelJob:job});return {ok:true};}
    if(m.type==='PANEL_TRANSFER')return transferPanel(Array.isArray(m.keys)?m.keys:[]);
    // Làm mới: dừng lượt đang chạy (nếu có) và xoá bản nháp của bảng. Bài chưa chuyển sang web chỉ bị xoá khi panel đã hỏi và gửi discard.
    if(m.type==='PANEL_RESET'){const live=await getJob(),job=live?.mode==='panel'?live:(await StudioStorage.local.get('panelJob')).panelJob;
      const unsent=(job?.posts||[]).filter(p=>!p.transferredAt&&p.text?.trim()).length;if(unsent&&!m.discard)throw Error(`Còn ${unsent} bài chưa chuyển sang web.`);
      if(live?.mode==='panel'){if(['opening','running'].includes(live.status)){live.status='cancelled';live.progress='Đã làm mới.';}await StudioStorage.session.remove('job');}
      await StudioStorage.local.remove('panelJob');return {ok:true,removed:job?.posts?.length||0};}
    if(m.type==='PANEL_OPEN_WEB'){const tabs=await chrome.tabs.query({url:'https://vanxharu.github.io/quan-ly-page/*'});if(tabs[0])await chrome.tabs.update(tabs[0].id,{active:true});else await chrome.tabs.create({url:'https://vanxharu.github.io/quan-ly-page/',active:true});return {ok:true};}
    throw Error('Lệnh bảng AI không hợp lệ.');
  }
  if(m?.type==='CUSTOMER_AVATAR_REPORT'&&fromWeb){
    const pageId=String(m.payload?.pageId||'');if(!/^\d{5,30}$/.test(pageId))throw Error('Page báo lỗi không hợp lệ.');
    const text=value=>String(value||'').replace(/https?:\/\/\S+/gi,'[link]').replace(/(?:access_token|authorization|cookie|token)\s*[:=]\s*[^\s,;]+/gi,'[ẩn]').replace(/EA[A-Za-z0-9_-]{20,}/g,'[ẩn]').slice(0,120);
    const items=(Array.isArray(m.payload?.items)?m.payload.items:[]).slice(0,50).filter(item=>/^\d{5,30}$/.test(String(item?.id||''))).map(item=>({id:String(item.id),hasPhoto:item.hasPhoto===true,errors:(Array.isArray(item.errors)?item.errors:[]).slice(0,2).map(e=>({stage:text(e.stage),code:text(e.code),subcode:text(e.subcode),message:text(e.message)}))}));
    return callUpdater('avatar_diagnostic',{pageId,items});
  }
  if(m?.type==='CUSTOMER_PROFILES'&&fromWeb){const ids=(Array.isArray(m.payload?.ids)?m.payload.ids:[]).map(String).filter(id=>/^\d{5,30}$/.test(id)).slice(0,50);return {ok:true,profiles:await localCustomerProfiles(ids)};}
  if(m?.type==='CUSTOMER_PROFILE'&&fromWeb)return {ok:true,profile:await lookupPublicProfile(m.payload)};
  if(m?.type==='CATALOG_SYNC'&&fromWeb){const catalog=cleanCatalog(m.payload);await StudioStorage.local.set({pageCatalog:catalog,studioTheme:catalog.theme});return {ok:true};}
  if(m?.type==='SETTINGS_GET'&&fromWeb)return {ok:true,settings:P.settings((await StudioStorage.local.get('studioSettings')).studioSettings),defaults:{postPrompt:P.POST_PROMPT,imagePrompt:P.IMAGE_PROMPT}};
  if(m?.type==='SETTINGS_SAVE'&&fromWeb){const job=await getJob();if(updatingExtension||job&&['opening','running'].includes(job.status))throw Error('Chờ lượt tạo hoặc cập nhật hoàn tất trước khi đổi lệnh.');const current=P.settings((await StudioStorage.local.get('studioSettings')).studioSettings);const settings=P.settings({...current,postPrompt:m.payload?.postPrompt,imagePrompt:m.payload?.imagePrompt});await StudioStorage.local.set({studioSettings:settings});return {ok:true,settings};}
  if(m?.type==='THEME_SYNC'&&fromWeb){await StudioStorage.local.set({studioTheme:m.payload?.theme==='dark'?'dark':'light'});return {ok:true};}
  if(m?.type==='TRANSFER_PULL'&&fromWeb){const transfer=(await StudioStorage.local.get('pendingTransfer')).pendingTransfer;return {ok:true,transfer:transfer?.webTab===sender.tab.id?transferBatch(transfer):null};}
  if(m?.type==='TRANSFER_ACK'&&fromWeb){const transfer=(await StudioStorage.local.get('pendingTransfer')).pendingTransfer,batch=transferBatch(transfer);if(!batch||batch.id!==m.payload?.id||transfer.webTab!==sender.tab.id)throw Error('Xác nhận chuyển bài không hợp lệ.');const live=await getJob(),job=live?.id===transfer.sourceJobId?live:(await StudioStorage.local.get('panelJob')).panelJob;if(job?.id===transfer.sourceJobId){for(const post of job.posts)if(batch.posts.some(p=>p.key===post.key))post.transferredAt=Date.now();if(live?.id===job.id)await save(job);else await StudioStorage.local.set({panelJob:job});}transfer.cursor=(transfer.cursor||0)+batch.posts.length;if(transfer.cursor<transfer.posts.length)await StudioStorage.local.set({pendingTransfer:transfer});else await StudioStorage.local.remove('pendingTransfer');return {ok:true};}
  if(m?.type==='STATUS'&&fromWeb){const job=await getJob();return {ok:true,version:WORKER_VERSION,job:job?.webTab===sender.tab.id?{id:job.id,status:job.status,posts:job.posts||[],error:job.error||'',progress:job.progress||'',reviewKey:job.pendingCommit||'',diagnostic:job.diagnostic||null}:null};}
  if(m?.type==='GENERATE'&&fromWeb){
    if(updatingExtension)throw Error('Tiện ích đang cập nhật. Hãy chờ nạp lại xong.');
    const existing=await getJob();
    if(existing&&['opening','running'].includes(existing.status))throw Error('Đang có một lượt tạo bài. Hãy chờ hoàn tất hoặc bấm Dừng.');
    if(!/^ai-[a-zA-Z0-9_-]{1,90}$/.test(m.id))throw Error('Mã yêu cầu không hợp lệ.');
    const input=await configureInput(P.validate(m.payload));await attachHistory(input,(await StudioStorage.local.get('pageCatalog')).pageCatalog);
    const job={id:m.id,nonce:crypto.randomUUID(),webTab:sender.tab.id,gptTab:null,input,posts:[],status:'opening',progress:'Đang mở ChatGPT…',updatedAt:Date.now()};
    await save(job);
    try{const tab=await chrome.tabs.create({url:job?.input?.settings?.gptHome||await homeFor(),active:true});job.gptTab=tab.id;await save(job);}catch(e){await finish(job,'Không mở được tab ChatGPT.');throw e;}
    return {ok:true,id:job.id};
  }
  if(m?.type==='DRAFT_SAVED'&&fromWeb){const job=await getJob();if(!job||job.webTab!==sender.tab.id||job.id!==m.payload?.jobId||!['opening','running'].includes(job.status)||!job.pendingCommit||job.pendingCommit!==m.payload?.key)throw Error('Xác nhận lưu bài không hợp lệ.');job.reviewSaved=job.pendingCommit;await save(job);return {ok:true};}
  if(m?.type==='CANCEL'&&fromWeb){const job=await getJob();if(job?.webTab===sender.tab.id&&['opening','running'].includes(job.status)){job.status='cancelled';job.updatedAt=Date.now();await save(job);await notify(job,'RESULT',{posts:job.posts||[],error:'Đã dừng nhận kết quả. Nếu ChatGPT còn tạo ảnh, bạn có thể bấm Dừng ở tab đó.'});}return {ok:true};}
  if(!fromGPT)throw Error('Trang gửi yêu cầu không được phép.');
  const job=await getJob();
  if(!job||!['opening','running'].includes(job.status))return {ok:true,job:null,cancelled:true};
  if(job.transport==='embedded'){
    if(m.type==='CLAIM')return {ok:true,job:null,cancelled:true};
    if(m.nonce!==job.nonce||m.id!==job.id)return {ok:true,job:null,cancelled:true};
    if(job.frameDocumentId&&sender.documentId&&job.frameDocumentId!==sender.documentId)return {ok:true,job:null,cancelled:true};
    if(job.frameClaimed&&!job.frameDocumentId&&sender.documentId){job.frameDocumentId=sender.documentId;job.frameBindingInfo={...job.frameBindingInfo,documentIdAvailableLater:true};await save(job);}
    if(!job.frameClaimed){if(!['START','FRAME_CLAIM'].includes(m.type))return {ok:true,job:null,cancelled:true};job.frameClaimed=true;job.frameDocumentId=sender.documentId||null;job.frameBindingInfo={hasDocumentId:!!sender.documentId,hasTab:!!sender.tab,frameId:Number.isInteger(sender.frameId)?sender.frameId:null};await save(job);}
  }else if(job.gptTab!==sender.tab?.id)return {ok:true,job:null,cancelled:true};
  if(m.type==='CLAIM'&&m.agentVersion!=='2.5.3'){await finish(job,'Tab ChatGPT đang dùng tiện ích cũ. Cập nhật tiện ích và tải lại cả trang Meta Assistant lẫn tab ChatGPT.');return {ok:false,error:'Phiên bản tiện ích trong tab ChatGPT chưa đồng bộ.'};}
  if(m.type==='CLAIM')return {ok:true,job:{id:job.id,nonce:job.nonce,input:inputFor(job),index:job.currentIndex||0,total:job.input.items.length,status:job.status}};
  if(m.nonce!==job.nonce||m.id!==job.id)throw Error('Lượt tạo không hợp lệ.');
  if(m.type==='FRAME_CLAIM')return {ok:true};
  if(m.type==='START'){if(job.status!=='opening')throw Error('Lượt này đã bắt đầu, không gửi lại yêu cầu.');job.status='running';job.updatedAt=Date.now();await save(job);return {ok:true};}
  if(m.type==='PROGRESS'){job.updatedAt=Date.now();job.progress=String(m.text||'').slice(0,500);if(m.diagnostic)job.diagnostic=m.diagnostic;await save(job);await notify(job,'PROGRESS',{text:job.progress});return {ok:true};}
  if(m.type==='TEXT_RESULT'){const active=job.input.items[job.currentIndex||0];if(!active||m.key!==active.key)throw Error('Chỉ nhận bài đang được giao.');const input={...job.input,items:[active]};if(!input.items.length)throw Error('Không tìm thấy bài được giao.');const posts=P.parse(m.text,input);job.posts=[...job.posts.filter(post=>!posts.some(p=>p.key===post.key)),...posts];job.updatedAt=Date.now();await save(job);await rememberPosts(posts);await notify(job,'PARTIAL',{posts:job.posts});return {ok:true,posts:job.posts};}
  if(m.type==='IMAGE_RESULT'){
    const post=job.posts.find(x=>x.key===m.key);if(m.key!==job.input.items[job.currentIndex||0]?.key)throw Error('Ảnh không thuộc bài đang tạo.');if(!post)throw Error('Không tìm thấy bài để gắn ảnh.');
    if(m.data&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.data)||m.data.length>600000))throw Error('Ảnh không hợp lệ hoặc quá lớn.');
    post.imageData=m.data||'';post.imageError=String(m.error||'').slice(0,500);job.updatedAt=Date.now();await save(job);await notify(job,'PARTIAL',{posts:job.posts});return {ok:true};
  }
  if(m.type==='COMMIT_POST'){const active=job.input.items[job.currentIndex||0],post=job.posts.find(p=>p.key===active?.key);if(!post||m.key!==active.key||job.input.images&&!post.imageData)throw Error('Bài hoặc ảnh chưa hoàn tất.');job.pendingCommit=post.key;job.reviewSaved='';if(job.mode==='panel'){job.completedKeys=[...new Set([...(job.completedKeys||[]),post.key])];job.reviewSaved=post.key;await save(job);return {ok:true};}await save(job);await StudioStorage.local.set({reviewOutbox:{id:job.id,webTab:job.webTab,posts:job.posts,updatedAt:Date.now()}});try{await chrome.tabs.update(job.webTab,{active:true});}catch{}await notify(job,'PARTIAL',{posts:job.posts,reviewKey:post.key});return {ok:true};}
  if(m.type==='NEXT_ITEM'){const active=job.input.items[job.currentIndex||0];if(!active||m.key!==active.key)throw Error('Bài không đúng thứ tự.');if(job.pendingCommit!==active.key||job.reviewSaved!==active.key){if(job.pendingCommit){try{await chrome.tabs.update(job.webTab,{active:true});}catch{}await notify(job,'PARTIAL',{posts:job.posts,reviewKey:job.pendingCommit});}return {ok:true,waiting:true};}job.currentIndex=(job.currentIndex||0)+1;job.pendingCommit='';job.reviewSaved='';await attachHistory(job.input,(await StudioStorage.local.get('pageCatalog')).pageCatalog);await save(job);const next=job.input.items[job.currentIndex];if(next&&job.gptTab){try{await chrome.tabs.update(job.gptTab,{active:true});}catch{}}return {ok:true,input:next?inputFor(job):null,index:job.currentIndex,total:job.input.items.length};}
  if(m.type==='DONE'){if((job.currentIndex||0)<job.input.items.length)throw Error('Chưa lưu hết bài vào danh sách duyệt.');await finish(job);return {ok:true};}
  if(m.type==='FAILED'){await finish(job,String(m.error||'Không hoàn tất được lượt tạo.').slice(0,1000));return {ok:true};}
  return {ok:true};
}
// Tuần tự hoá để hai tab không cùng mở lượt mới hoặc ghi đè trạng thái.
let messages=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message?.type==='OPEN_PANEL'&&P.website(sender.url)){openStudio(sender.tab).then(()=>respond({ok:true}),e=>respond({ok:false,error:e.message}));return true;}const independent=['CUSTOMER_PROFILE','CUSTOMER_PROFILES','CUSTOMER_AVATAR_REPORT'].includes(message?.type)&&P.website(sender.url);const task=independent?handle(message,sender):messages.then(()=>handle(message,sender));if(!independent)messages=task.catch(()=>{});task.then(respond,e=>respond({ok:false,error:e.message}));return true;});
chrome.tabs.onRemoved.addListener(async tabId=>{bridgeChecks.delete(tabId);await StudioStorage.session.remove?.('webBridgeReloadV1:'+tabId);const job=await getJob();if(job?.gptTab===tabId&&['opening','running'].includes(job.status))await finish(job,'Tab ChatGPT đã đóng. Các bài đã nhận vẫn được giữ trên web.');});
