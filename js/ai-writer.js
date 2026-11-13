/* Studio AI: một quy trình Reddit dùng chung; tạo tại tiện ích, duyệt tại web. */
(() => {
  const pending=new Map(),P=MetaAIProtocol;
  let reviewWrites=Promise.resolve(),bridgeOffline=false,bridgeNoticeShown=false;
  const studioVersionOK=version=>{const v=String(version||'').split('.').map(Number),min=[2,5,0];if(v.length!==3||v.some(n=>!Number.isInteger(n)||n<0))return false;for(let i=0;i<3;i++)if(v[i]!==min[i])return v[i]>min[i];return true;};
  const send=(type,payload,waitMs=4000)=>new Promise((resolve,reject)=>{
    if(bridgeOffline){const error=Error('Web đang chờ nối lại tiện ích sau cập nhật.');error.code='BRIDGE_DISCONNECTED';reject(error);return;}
    const id=uid('ai');const timeout=setTimeout(()=>{pending.delete(id);reject(Error(type==='CUSTOMER_PROFILE'?'Cần cập nhật tiện ích và bộ kết nối Windows để xác minh UID.':'Cần tiện ích 2.5.0 để tạo từng bài và lưu chờ duyệt. Cập nhật tiện ích rồi tải lại trang.'));},waitMs);
    pending.set(id,{resolve,reject,timeout});window.postMessage({source:'META_ASSISTANT_AI_V106',type,id,payload},location.origin);
  });
  App.reportCustomerAvatarDiagnostics = async (pageId,items) => {
    try{const result=await send('CUSTOMER_AVATAR_REPORT',{pageId,items},10000);App.avatarDiagnosticTransport={ok:true,at:Date.now()};return result;}
    catch(error){App.avatarDiagnosticTransport={ok:false,at:Date.now(),error:String(error.message||'Không gửi được báo lỗi.')};throw error;}
  };
  App.lookupKnownCustomerProfiles = async ids => (await send('CUSTOMER_PROFILES',{ids},15000)).profiles||[];
  App.lookupCustomerProfile = async (profile,force=false) => (await send('CUSTOMER_PROFILE',{profile,force},90000)).profile;
  function safePosts(posts){return (Array.isArray(posts)?posts:[]).filter(p=>p&&typeof p.key==='string').map(p=>{
    const imageData=typeof p.imageData==='string'?p.imageData:'';
    if(imageData&&(imageData.length>600000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)))throw Error('Ảnh bài viết không hợp lệ hoặc vượt kích thước cho phép. Chưa nhận bản này để tránh mất ảnh.');
    return {key:p.key.slice(0,80),topicTitle:String(p.topicTitle||'').slice(0,300),pageId:String(p.pageId||'').slice(0,40),pageName:String(p.pageName||'').slice(0,300),text:String(p.text||'').slice(0,18000),imagePrompt:String(p.imagePrompt||'').slice(0,5000),imageData,imageRequired:p.imageRequired===true,imageError:String(p.imageError||'').slice(0,500),sources:P.sources(p.sources)};
  });}
  let importBusy=false,catalogTimer;
  function studioAvatar(page){try{const url=new URL(App.pageAvatarUrl(page));if(url.protocol!=='https:'||url.username||url.password)return '';for(const key of ['access_token','token','authorization','auth'])url.searchParams.delete(key);return url.href;}catch{return '';}}
  async function syncCatalog(){
    if(!App.pages?.length)return;
    const queue=await DB.get('fbScheduleQueueV1',[]);
    const pages=App.pages.map(page=>({id:page.id,name:page.name,avatar:studioAvatar(page),selected:App.selected().some(p=>p.id===page.id),recentPosts:P.recentPosts(queue.filter(post=>String(post.pageKey)===String(page.id)).map(post=>({key:post.aiSourceId||post.id,topicTitle:post.topicTitle,text:post.text,createdAt:post.createdAt||post.at||0})))}));
    await send('CATALOG_SYNC',{pages,theme:document.body.classList.contains('dark-mode')?'dark':'light'});
  }
  function queueCatalog(){clearTimeout(catalogTimer);catalogTimer=setTimeout(()=>syncCatalog().catch(()=>{}),250);}
  async function importPanel(){
    if(importBusy||bridgeOffline||!App.pages?.length)return;importBusy=true;
    try{
      const result=await send('TRANSFER_PULL'),transfer=result.transfer;if(!transfer)return;
      const posts=safePosts(transfer.posts);if(!posts.length)throw Error('Không có bài để nhận.');
      for(const post of posts)if(!App.pageById(post.pageId))throw Error('Kết nối Page '+post.pageName+' trước khi nhận bài từ tiện ích.');
      const snapshot=posts.map(p=>({...p}));
      reviewWrites=reviewWrites.catch(()=>{}).then(async()=>{
        const queue=await DB.get('fbScheduleQueueV1',[]);
        for(const post of snapshot){const sourceId=transfer.sourceJobId+'|'+post.key;const existing=queue.find(x=>x.aiSourceId===sourceId);
          if(existing){if(['draft','error'].includes(existing.status)){const repairMissingImage=existing.imageRequired&&!existing.imageData&&!!post.imageData;if(existing.aiOriginalText!==undefined&&existing.text===existing.aiOriginalText)existing.text=post.text;if(repairMissingImage||existing.aiOriginalImage!==undefined&&existing.imageData===existing.aiOriginalImage)existing.imageData=post.imageData;if(repairMissingImage){existing.status='draft';existing.error='';}existing.aiOriginalText=post.text;existing.aiOriginalImage=post.imageData;existing.imageRequired=post.imageRequired;existing.imageError=post.imageError;existing.sources=post.sources;}continue;}
          queue.push({id:uid('fs'),pageKey:post.pageId,pageName:App.pageById(post.pageId).name,text:post.text,imageData:post.imageData,imageRequired:post.imageRequired,imageError:post.imageError,at:0,status:'draft',createdAt:Date.now(),source:'chatgpt-extension',sources:post.sources,topicTitle:post.topicTitle||'',aiSourceId:sourceId,aiOriginalText:post.text,aiOriginalImage:post.imageData,aiGenerating:false});
        }
        await DB.set('fbScheduleQueueV1',queue);
      });await reviewWrites;
      await send('TRANSFER_ACK',{id:transfer.id});queueCatalog();window.dispatchEvent(new Event('ai-drafts-updated'));
      App.setSelected([...new Set([...App.selected().map(p=>p.id),...posts.map(p=>p.pageId)])]);App.show('planner');await App.tabs.planner?.refresh();toast('Đã nhận '+posts.length+' bài từ tiện ích vào Lịch đăng · Chờ duyệt.',6000);
    }catch(error){if(error.code!=='BRIDGE_DISCONNECTED')toast('Nhận bài từ tiện ích: '+error.message,6000);}finally{importBusy=false;}
  }
  async function openStudio(){
    syncCatalog().catch(()=>{});
    try{const state=await send('STATUS');if(studioVersionOK(state.version)){toast('Studio AI mở ở bên cạnh. Bạn cũng có thể bấm biểu tượng tiện ích để mở lại.',5000);return;}}catch{}
    const help=h('dialog',{className:'ai-dialog'});help.append(h('h2',{textContent:'Mở Studio AI bên cạnh'}),h('p',{textContent:'Cập nhật tiện ích lên 2.6.0, bấm Tải lại tại chrome://extensions rồi tải lại trang này. Sau đó bấm biểu tượng tiện ích Meta Assistant để mở bảng tạo bài.'}),h('a',{className:'btn btn-primary',href:'chatgpt-connector.zip?v=2.6.0',download:'meta-assistant-chatgpt-connector.zip',textContent:'Tải tiện ích Studio AI 2.6.0'}),h('button',{className:'btn btn-ghost',textContent:'Đóng',onclick:()=>help.close()}));document.body.append(help);help.addEventListener('close',()=>help.remove());help.showModal();
  }
  window.addEventListener('meta-theme-changed',()=>send('THEME_SYNC',{theme:document.body.classList.contains('dark-mode')?'dark':'light'}).catch(()=>{}));
  App.onLogin.push(()=>{queueCatalog();importPanel().catch(()=>{});});App.onPageChange.push(queueCatalog);
  setTimeout(queueCatalog,1500);setInterval(()=>{if(!document.hidden)importPanel().catch(()=>{});},4000);
  window.addEventListener('message',async e=>{
    const m=e.data;if(e.source!==window||e.origin!==location.origin||m?.source!=='META_AI_CONNECTOR_V106')return;
    if(m.type==='REPLY'&&pending.has(m.id)){
      if(m.code==='BRIDGE_DISCONNECTED'){
        bridgeOffline=true;const error=Error(m.error||'Web đang chờ nối lại tiện ích sau cập nhật.');error.code=m.code;
        for(const p of pending.values()){clearTimeout(p.timeout);p.reject(error);}pending.clear();
        if(!bridgeNoticeShown){bridgeNoticeShown=true;toast('Đang nối lại tiện ích. Nếu trang chưa tự tải lại, bấm F5 một lần.',8000);}return;
      }
      const p=pending.get(m.id);clearTimeout(p.timeout);pending.delete(m.id);m.ok?p.resolve(m):p.reject(Error(m.error||'Tiện ích chưa sẵn sàng.'));return;
    }
    if(m.type==='THEME_CHANGED'){setDark(m.theme==='dark');return;}
    if(m.type==='BRIDGE_READY'){bridgeOffline=false;bridgeNoticeShown=false;App.flushCustomerAvatarDiagnostics?.();window.dispatchEvent(new Event('customer-avatars-ready'));queueCatalog();importPanel().catch(()=>{});return;}
    if(m.type==='PANEL_IMPORT_READY')await importPanel();
  });
  function overview(host,mode){
    let revision=0;
    const draw=async()=>{
      const own=++revision,queue=await DB.get('fbScheduleQueueV1',[]);if(own!==revision)return;
      const posts=queue.filter(p=>['chatgpt','chatgpt-extension'].includes(p.source)&&App.selected().some(page=>page.id===p.pageKey)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      host.replaceChildren(h('div',{className:'card ai-draft-overview'},
        h('div',{className:'card-head'},h('h3',{className:'card-title',textContent:'Bài AI đã chuyển sang web'+(posts.length?' · '+posts.length:'')}),h('button',{type:'button',className:'btn btn-ghost btn-sm',textContent:'Mở danh sách duyệt',onclick:()=>App.show('planner')})),
        posts.length?h('div',{className:'ai-draft-grid'},...posts.slice(0,6).map(post=>h('article',{className:'ai-draft-tile'},
          post.imageData?h('img',{src:post.imageData,alt:'Ảnh bài '+post.pageName,loading:'lazy'}):h('div',{className:'ai-draft-image-placeholder',textContent:'Bài viết'}),
          h('div',{className:'ai-draft-tile-body'},h('strong',{textContent:post.pageName}),h('p',{className:'ai-draft-excerpt',textContent:post.text}),h('button',{type:'button',className:'btn btn-soft',textContent:'Xem & xếp lịch',onclick:()=>App.show('planner')}))))) :
          h('p',{className:'hint',textContent:'Tạo bài và ảnh trong Studio AI bên cạnh, rồi bấm Đưa sang web. Bài bạn chọn sẽ xuất hiện tại đây và trong Lịch đăng · Chờ duyệt.'})));
    };
    const refresh=()=>draw().catch(()=>{});window.addEventListener('ai-drafts-updated',refresh);App.onPageChange.push(refresh);App.onLogin.push(refresh);refresh();
  }
  App.ai={open:openStudio,overview,syncCatalog:queueCatalog,getSettings:()=>send('SETTINGS_GET',{}),saveSettings:value=>send('SETTINGS_SAVE',value)};
})();
