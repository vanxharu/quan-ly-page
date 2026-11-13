(() => {
  if(location.origin!=='https://vanxharu.github.io'||!location.pathname.startsWith('/quan-ly-page/'))return;
  const BRIDGE_VERSION='2.6.2';
  let trustedAt=-Infinity,disconnected=false;
  document.addEventListener('click',e=>{if(e.isTrusted&&e.composedPath().some(el=>el?.matches?.('[data-ai-sidepanel]'))){chrome.runtime.sendMessage({type:'OPEN_PANEL'}).catch(()=>{});}if(e.isTrusted&&e.composedPath().some(el=>el?.matches?.('[data-ai-generate]')))trustedAt=performance.now();},true);
  const reply=data=>window.postMessage({source:'META_AI_CONNECTOR_V106',...data},location.origin);
  window.addEventListener('message',async e=>{
    const m=e.data;if(e.source!==window||e.origin!==location.origin||m?.source!=='META_ASSISTANT_AI_V106'||!['STATUS','CUSTOMER_PROFILE','CUSTOMER_PROFILES','CUSTOMER_AVATAR_REPORT','GENERATE','CANCEL','DRAFT_SAVED','CATALOG_SYNC','THEME_SYNC','SETTINGS_GET','SETTINGS_SAVE','TRANSFER_PULL','TRANSFER_ACK'].includes(m.type)||typeof m.id!=='string')return;
    if(m.type==='GENERATE'&&(performance.now()-trustedAt>3000)){reply({type:'REPLY',id:m.id,ok:false,error:'Bấm nút Tạo bằng ChatGPT trên trang để bắt đầu.'});return;}
    if(m.type==='GENERATE')trustedAt=-Infinity;
    if(disconnected){reply({type:'REPLY',id:m.id,ok:false,code:'BRIDGE_DISCONNECTED',error:'Web đang chờ nối lại tiện ích sau cập nhật.'});return;}
    try{const result=await chrome.runtime.sendMessage({type:m.type,id:m.id,payload:m.payload});reply({type:'REPLY',id:m.id,...result});}catch(e){const invalid=/context invalidated|receiving end does not exist|extension.*(?:disconnected|unloaded)|message port closed/i.test(String(e?.message||e));if(invalid)disconnected=true;reply({type:'REPLY',id:m.id,ok:false,...(invalid?{code:'BRIDGE_DISCONNECTED'}:{}),error:invalid?'Web đang chờ nối lại tiện ích sau cập nhật.':String(e?.message||'Chưa nhận được phản hồi từ tiện ích.')});}
  });
  reply({type:'BRIDGE_READY',version:BRIDGE_VERSION});
  chrome.runtime.onMessage.addListener((m,_sender,respond)=>{if(m?.channel==='META_AI_EVENT'){if(m.type==='BRIDGE_PING'){respond({ok:!disconnected,version:BRIDGE_VERSION});return;}reply(m);respond({ok:true});}});
})();
