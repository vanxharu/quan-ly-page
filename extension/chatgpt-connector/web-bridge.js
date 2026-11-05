(() => {
  if(location.origin!=='https://vanxharu.github.io'||!location.pathname.startsWith('/quan-ly-page/'))return;
  let trustedAt=-Infinity;
  document.addEventListener('click',e=>{if(e.isTrusted&&e.composedPath().some(el=>el?.matches?.('[data-ai-sidepanel]'))){chrome.runtime.sendMessage({type:'OPEN_PANEL'}).catch(()=>{});}if(e.isTrusted&&e.composedPath().some(el=>el?.matches?.('[data-ai-generate]')))trustedAt=performance.now();},true);
  const reply=data=>window.postMessage({source:'META_AI_CONNECTOR_V106',...data},location.origin);
  window.addEventListener('message',async e=>{
    const m=e.data;if(e.source!==window||e.origin!==location.origin||m?.source!=='META_ASSISTANT_AI_V106'||!['STATUS','GENERATE','CANCEL','DRAFT_SAVED','CATALOG_SYNC','THEME_SYNC','TRANSFER_PULL','TRANSFER_ACK'].includes(m.type)||typeof m.id!=='string')return;
    if(m.type==='GENERATE'&&(performance.now()-trustedAt>3000)){reply({type:'REPLY',id:m.id,ok:false,error:'Bấm nút Tạo bằng ChatGPT trên trang để bắt đầu.'});return;}
    if(m.type==='GENERATE')trustedAt=-Infinity;
    try{const result=await chrome.runtime.sendMessage({type:m.type,id:m.id,payload:m.payload});reply({type:'REPLY',id:m.id,...result});}catch(e){reply({type:'REPLY',id:m.id,ok:false,error:'Tiện ích đã ngắt kết nối. Tải lại trang sau khi cài hoặc cập nhật tiện ích.'});}
  });
  reply({type:'BRIDGE_READY'});
  chrome.runtime.onMessage.addListener((m,_sender,respond)=>{if(m?.channel==='META_AI_EVENT'){reply(m);respond({ok:true});}});
})();
