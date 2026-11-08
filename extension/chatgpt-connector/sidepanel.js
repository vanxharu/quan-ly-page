(() => {
  const $=id=>document.getElementById(id),panelId=crypto.randomUUID(),P=MetaAIProtocol,UI_VERSION='2.5.1';
  $('appVersion').textContent='v'+UI_VERSION;
  $('postPrompt').textContent=P.POST_PROMPT;$('imagePrompt').textContent=P.IMAGE_PROMPT;
  let settingsKey='',updating=false,state={},catalogStamp=0,choices={},loadTimer,view='compose',transport='embedded',frameReady=false,frameLoaded=false,frameDelivered=false,pendingRun=null,frameTimer,runAckTimer,frameAck=false,frameClaimed=false,lastFrameInfo=null,versionMismatch=false,frameNavigationReady=false,bufferedReady=null,frameJobId='';
  const node=(tag,props={},...children)=>{const el=document.createElement(tag);Object.assign(el,props);el.append(...children.filter(x=>x!=null));return el;};
  const call=async(type,extra={})=>{const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error(r?.error||'Tiện ích chưa sẵn sàng.');return r;};
  const generating=()=>['opening','running'].includes(state.panelJob?.status)||state.externalRunning;
  const busy=()=>updating||generating();
  const ready=()=>state.panelJob?.posts?.filter(p=>!p.transferredAt&&(state.panelJob.completedKeys?.includes(p.key)||!['opening','running'].includes(state.panelJob.status)&&p.text?.trim()))||[];
  const count=()=>Math.max(1,Math.trunc(Number($('count').value))||1);
  const selected=()=>(state.pageCatalog?.pages||[]).filter(p=>choices[p.id]?.checked);
  const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase();
  function notice(text,error=false){$('notice').hidden=!text;$('notice').textContent=text||'';$('notice').className=error?'error':'';}
  function avatar(page,small=false){const el=node('span',{className:'avatar'+(small?' small':''),textContent:(page.name||'Page').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()});if(page.avatar){const img=node('img',{src:page.avatar,alt:'',loading:'lazy',referrerPolicy:'no-referrer',onerror:()=>img.remove()});el.append(img);}return el;}
  function applyTheme(){const theme=state.studioTheme||state.pageCatalog?.theme||'light';document.documentElement.dataset.theme=theme;if(frameReady&&frameLoaded)$('gptFrame').contentWindow.postMessage({source:'META_STUDIO_PANEL',type:'FRAME_THEME',theme},'https://chatgpt.com');$('themeToggle').textContent=theme==='dark'?'☼':'☾';$('themeToggle').title=theme==='dark'?'Chuyển sang sáng, đồng bộ với web':'Chuyển sang tối, đồng bộ với web';}
  function footer(){$('updateExtension').disabled=!!busy();$('updateExtension').textContent=updating?'Đang cập nhật…':'Cập nhật';const n=ready().length,active=busy();$('generate').hidden=view!=='compose'||!!n;$('generate').disabled=!!active||!!n||versionMismatch;$('generate').textContent=updating?'Đang cập nhật…':active?'Đang tạo…':`✦ Tạo${selected().length?' '+selected().length*count():''} ${$('images').checked?'bài & ảnh':'bài viết'}`;$('transfer').hidden=view==='compose'&&!n;$('transfer').disabled=updating||!n||!!state.pendingTransfer;$('transfer').textContent=state.pendingTransfer?'Đang chờ web xác nhận…':n?`Đưa ${n} bản nháp sang web ↗`:'Chưa có bài sẵn sàng';$('cancel').hidden=!generating();$('transferHint').textContent=n?'Giữ đúng Page · Chuyển vào danh sách chờ duyệt':active?((state.panelJob?.transport||transport)==='embedded'?'Giữ bảng mở khi GPT đang tạo · Nháp tự lưu':'Đang xử lý · Không giới hạn thời gian chờ'):'Tạo từng bài + ảnh · Lưu trước khi tạo tiếp';}
  function scope(){$('historyHint').textContent='Ghi nhớ tối đa 8 bài gần đây mỗi Page · Từng bài và ảnh được lưu trước khi tạo tiếp.';$('selectedCount').textContent=`${selected().length} Page đã chọn`;$('scope').textContent=`${selected().length} Page × ${count()} bài = ${selected().length*count()} bài riêng. Tạo lần lượt từng bài và ảnh; tự lưu sau mỗi bài.`;footer();}
  async function remember(){await chrome.storage.local.set({studioChoices:choices});scope();}
  function drawPages(){
    const pages=state.pageCatalog?.pages||[],search=normalized($('pageSearch').value);
    $('catalogHint').textContent=pages.length?'':'Mở website và đăng nhập Page để đồng bộ Page và avatar.';
    const visible=pages.filter(p=>normalized(p.name+' '+p.id).includes(search));
    $('pages').replaceChildren(...visible.map(page=>{
      const choice=choices[page.id]||(choices[page.id]={checked:page.selected});
      const card=node('div',{className:'page'+(choice.checked?' selected':'')});
      const check=node('input',{type:'checkbox',checked:choice.checked,disabled:!!busy(),onchange:e=>{choice.checked=e.target.checked;card.className='page'+(choice.checked?' selected':'');remember().catch(e=>notice(e.message,true));}});
      const info=node('span',{className:'page-info'},node('strong',{textContent:page.name,title:page.name}),node('span',{textContent:'Page · …'+page.id.slice(-6)}));
      card.append(node('label',{className:'page-label'},avatar(page),info,check));const recent=P.recentPosts([...(state.marketingHistoryV1?.[page.id]||[]),...(page.recentPosts||[])]);if(recent.length)card.append(node('p',{className:'previous-post',textContent:'Tránh lặp: '+(recent[0].topicTitle||recent[0].text.slice(0,85)),title:recent[0].text}));return card;
    }));if(!visible.length&&pages.length)$('pages').append(node('p',{className:'hint',textContent:'Không tìm thấy Page phù hợp.'}));scope();
  }
  function switchView(target){
    view=target;$('settingsView').hidden=target!=='settings';document.querySelector('footer').hidden=target==='settings';for(const button of document.querySelectorAll('[data-target]'))button.setAttribute('aria-selected',String(button.dataset.target===target));
    $('composeView').hidden=target!=='compose';$('draftsView').hidden=target!=='drafts';
    $('gptView').hidden=target!=='gpt'&&!frameLoaded;$('gptView').classList.toggle('offscreen',target!=='gpt'&&frameLoaded);$('gptView').setAttribute('aria-hidden',String(target!=='gpt'));$('gptFrame').tabIndex=target==='gpt'?0:-1;
    $('workspace').classList.toggle('chat-active',target==='gpt');progressVisibility();footer();
    if(target==='gpt'&&transport==='embedded'&&!frameLoaded)mountFrame().catch(e=>{notice(e.message,true);$('frameWarning').hidden=false;});
  }
  function postRun(){if(!frameReady||!pendingRun||frameDelivered)return;frameDelivered=true;frameAck=false;frameClaimed=false;$('gptFrame').contentWindow.postMessage({source:'META_STUDIO_PANEL',type:'FRAME_RUN',job:pendingRun},'https://chatgpt.com');clearTimeout(runAckTimer);runAckTimer=setTimeout(()=>{if(!frameAck)notice('Khung GPT đã mở nhưng chưa xác nhận nhận lệnh. Bấm Tải báo lỗi để kiểm tra; chưa gửi lại yêu cầu.',true);},10000);}
  async function mountFrame(runJob=null){
    await call('PANEL_PREPARE_EMBED');if(frameLoaded&&!runJob)return;
    pendingRun=runJob;frameJobId=runJob?.id||'';frameNavigationReady=false;bufferedReady=null;frameDelivered=false;frameReady=false;frameLoaded=true;$('frameDot').classList.remove('ready');$('frameWarning').hidden=true;$('frameCover').hidden=false;$('frameStatus').textContent='Đang kết nối GPT…';
    const home=new URL(P.gptHomeURL(runJob?.input?.settings?.gptHome||state.studioSettings?.gptHome));if(runJob)home.searchParams.set('meta_studio_job',runJob.id);$('gptFrame').src=home.href;
    clearTimeout(frameTimer);frameTimer=setTimeout(()=>{if(!frameReady){$('frameStatus').textContent='Khung GPT chưa phản hồi';$('frameWarning').hidden=false;$('frameCover').hidden=true;}},15000);switchView(view);
  }
  function acceptFrameReady(message){
    if(pendingRun&&message.loadKey&&message.loadKey!==pendingRun.id)return;
    if(!frameNavigationReady){if(pendingRun&&message.loadKey===pendingRun.id)bufferedReady=message;return;}
    frameReady=true;clearTimeout(frameTimer);$('frameStatus').textContent=frameClaimed?'Đang theo dõi lượt tạo':frameAck?'GPT đã nhận lệnh':'Đã kết nối GPT';$('frameDot').classList.add('ready');$('frameCover').hidden=true;$('frameWarning').hidden=true;applyTheme();postRun();
  }
  $('gptFrame').onload=()=>{if(!frameLoaded)return;frameNavigationReady=true;if(bufferedReady){const ready=bufferedReady;bufferedReady=null;acceptFrameReady(ready);}};
  window.addEventListener('message',event=>{
    const message=event.data;if(event.origin!=='https://chatgpt.com'||event.source!==$('gptFrame').contentWindow||message?.source!=='META_STUDIO_GPT_FRAME')return;
    if(message.type==='FRAME_DIAGNOSTIC'){lastFrameInfo=message;return;}
    if(message.type==='FRAME_RUN_ACK'&&(message.jobId===frameJobId||message.jobId===pendingRun?.id||message.jobId===state.panelJob?.id)){frameAck=true;clearTimeout(runAckTimer);pendingRun=null;$('frameStatus').textContent='GPT đã nhận lệnh';return;}
    if(message.type==='FRAME_CLAIMED'&&(message.jobId===frameJobId||message.jobId===state.panelJob?.id)){frameClaimed=true;$('frameStatus').textContent='Đang theo dõi lượt tạo';return;}
    if(message.type==='FRAME_ERROR'&&(message.jobId===frameJobId||message.jobId===state.panelJob?.id||message.jobId===pendingRun?.id)){notice(message.error||'Không giao được lệnh cho GPT.',true);call('PANEL_FRAME_ERROR',{jobId:message.jobId,error:message.error}).then(load).catch(()=>{});return;}
    if(message.type!=='FRAME_READY')return;
    acceptFrameReady(message);
  });
  async function transfer(keys){try{notice('Đang chuyển bản nháp sang web…');await call('PANEL_TRANSFER',{keys});notice('Đã mở web. Bản nháp được giữ tại đây đến khi web xác nhận.');await load();}catch(e){notice(e.message,true);}}
  const imageLoads=new Map();
  const loadDraftImage=async(img,key)=>{try{const cacheKey=state.panelJob.id+':'+key;let pending=imageLoads.get(cacheKey);if(!pending){pending=call('PANEL_IMAGE',{key}).then(r=>r.imageData);imageLoads.set(cacheKey,pending);if(imageLoads.size>24)imageLoads.delete(imageLoads.keys().next().value);}const data=await pending;if(data&&img.isConnected)img.src=data;}catch{img.alt='Chưa tải được ảnh nháp';}};
  const imageObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){imageObserver.unobserve(entry.target);loadDraftImage(entry.target,entry.target.dataset.postImageKey);}}):null;
  function drawResults(){
    if(document.activeElement?.matches('textarea[data-key]'))return;imageObserver?.disconnect();
    const job=state.panelJob,posts=job?.posts||[];$('navCount').textContent=String(posts.length);$('draftCount').textContent=posts.length?`${job.completedKeys?.length||0}/${job.input.items.length} bài đã hoàn tất · Giữ đúng Page`:'Bài và ảnh được lưu ngay trong tiện ích.';$('empty').hidden=!!posts.length;
    $('results').replaceChildren(...posts.map((post,index)=>{
      const complete=job.completedKeys?.includes(post.key),canTransfer=complete||!['opening','running'].includes(job.status)&&!!post.text?.trim(),page=state.pageCatalog?.pages.find(p=>p.id===post.pageId)||{name:post.pageName};
      const card=node('article',{className:'draft'});card.append(node('div',{className:'draft-header'},avatar(page,true),node('div',{},node('h2',{textContent:post.pageName}),node('p',{textContent:post.topicTitle||'Bài '+(index+1)}))));
      card.append(node('span',{className:'pill',textContent:post.transferredAt?'Đã chuyển sang web':complete?'Đã lưu · Sẵn sàng chuyển':busy()?'Đang hoàn thiện bài & ảnh':'Bản nháp chưa đủ ảnh'}),node('p',{className:'draft-preview',textContent:post.text}));
      const refs=P.sources(post.sources);if(refs.length)card.append(node('details',{className:'source-links'},node('summary',{textContent:'Nguồn Reddit · '+refs.length}),...refs.map(ref=>node('a',{href:ref.url,target:'_blank',rel:'noopener noreferrer',textContent:ref.title||ref.url}))));
      if(post.imageData||post.hasImage){const img=node('img',{className:'draft-image',alt:'Ảnh bài '+(index+1)});if(post.imageData)img.src=post.imageData;else{img.dataset.postImageKey=post.key;if(imageObserver)imageObserver.observe(img);else loadDraftImage(img,post.key);}card.append(img);}
      const text=node('textarea',{value:post.text,rows:6,readOnly:!!busy(),onchange:async e=>{try{await call('PANEL_EDIT',{key:post.key,text:e.target.value});}catch(err){notice(err.message,true);}},onblur:()=>setTimeout(()=>load().catch(()=>{}),100)});text.dataset.key=post.key;text.setAttribute('aria-label','Sửa bài '+(index+1));
      card.append(node('details',{},node('summary',{textContent:busy()?'Xem nội dung đầy đủ':'Chỉnh sửa nội dung'}),text));
      if(post.imageError)card.append(node('p',{className:'hint',textContent:'Ảnh: '+post.imageError}));
      card.append(node('button',{className:'secondary',disabled:!canTransfer,textContent:post.transferredAt?'Mở lại trên web ↗':'Đưa bài này sang web ↗',onclick:()=>transfer([post.key])}));return card;
    }));
  }
  function progressVisibility(){const active=generating(),job=state.panelJob;$('progressBox').hidden=(!job&&!state.externalRunning)||(!active&&(job?.status==='done'||!['gpt','drafts'].includes(view)));}
  async function load(){
    state=await call('PANEL_STATUS');drawSettings();versionMismatch=state.version!==UI_VERSION;if(versionMismatch)notice('Bộ nền đang chạy bản '+(state.version||'không rõ')+'. Bấm Tải lại tiện ích tại chrome://extensions rồi mở bảng lại; F5 website không cập nhật bộ nền.',true);applyTheme();if(catalogStamp!==state.pageCatalog?.updatedAt){catalogStamp=state.pageCatalog?.updatedAt;}drawPages();
    const job=state.panelJob,active=generating(),locked=busy();['gptHome','customPostPrompt','customImagePrompt','useReddit','saveSettings','resetSettings'].forEach(id=>$(id).disabled=!!locked);if(job?.transport==='embedded'&&job.status==='running'&&job.frameClaimed){frameAck=true;frameClaimed=true;clearTimeout(runAckTimer);if(pendingRun?.id===job.id)pendingRun=null;$('frameStatus').textContent='Đang theo dõi lượt tạo';}document.querySelectorAll('#pages input,#pages select').forEach(el=>el.disabled=!!locked);$('selectAll').disabled=$('clearSelection').disabled=!!locked;
    $('gptMode').disabled=!!locked;$('reloadFrame').disabled=!!locked;progressVisibility();$('progressBox').dataset.state=job?.status||'';
    $('progressTitle').textContent=active?'Đang tạo nội dung':job?.status==='error'?'Lượt tạo trước cần kiểm tra':'Bản nháp đã lưu';const total=job?.input.items.length||1,complete=job?.completedKeys?.length||0;$('progress').value=Math.round(100*complete/total);$('loading').hidden=!active;$('progressCount').textContent=`${complete}/${job?.input.items.length||0}`;
    const label=state.externalRunning?'Có lượt đang chạy từ web. Bấm Dừng để chuyển sang Studio AI.':job?.error||job?.progress||'';$('progressText').textContent=label;$('progressText').title=label;
    const currentMode=active&&job?.transport?job.transport:transport;$('gptMode').value=currentMode;$('frameWrap').hidden=currentMode==='tab';$('tabModeHint').hidden=currentMode!=='tab';drawResults();footer();
  }
  function fillSettings(config){
    $('gptHome').value=config.gptHome;$('customPostPrompt').value=config.postPrompt;$('customImagePrompt').value=config.imagePrompt;$('useReddit').checked=config.reddit;
  }
  function drawSettings(){
    const config=P.settings(state.studioSettings),key=JSON.stringify(config);
    if(key!==settingsKey){settingsKey=key;fillSettings(config);}
    $('composeIntro').textContent=config.reddit?'Chọn Page. AI tìm ý tưởng marketing từ Reddit và viết bài mới cho bạn.':'Chọn Page. AI viết bài mới theo prompt bạn đã lưu trong Cài đặt.';$('workflowSteps').textContent=(config.reddit?'Reddit → ':'')+'bài mới → ảnh → bản nháp';
    $('postPrompt').textContent=config.postPrompt;$('imagePrompt').textContent=config.imagePrompt;
    const ratio=config.imagePrompt.match(/\b(\d{1,2})\s*[:/x×*]\s*(\d{1,2})\b/);
    $('imageFormat').textContent=ratio?ratio[1]+':'+ratio[2]+' · '+(Number(ratio[1])>Number(ratio[2])?'Ảnh ngang':Number(ratio[1])===Number(ratio[2])?'Ảnh vuông':'Ảnh dọc'):'Ảnh theo prompt';
  }
  async function saveSettings(reset=false){
    if(busy())return;
    try{const config=reset?P.settings():P.settings({gptHome:$('gptHome').value,postPrompt:$('customPostPrompt').value,imagePrompt:$('customImagePrompt').value,reddit:$('useReddit').checked});
      const previous=P.settings(state.studioSettings).gptHome;await call('PANEL_SAVE_SETTINGS',{settings:config});state.studioSettings=config;settingsKey='';drawSettings();
      if(previous!==config.gptHome){frameLoaded=false;frameReady=false;$('gptFrame').src='about:blank';}
      notice('Đã lưu trang GPT và prompt. Áp dụng từ lượt tạo tiếp theo.');
    }catch(error){notice(error.message,true);}
  }
  $('saveSettings').onclick=()=>saveSettings();$('resetSettings').onclick=()=>saveSettings(true);
  $('generate').onclick=async()=>{try{
    const pages=selected(),n=count();if(!pages.length)throw Error('Chọn ít nhất một Page.');if(!Number.isSafeInteger(n)||!Number.isSafeInteger(pages.length*n))throw Error('Số bài phải là số nguyên dương hợp lệ.');
    const items=[];for(const page of pages)for(let i=0;i<n;i++)items.push({key:'post-'+crypto.randomUUID(),pageId:page.id,pageName:page.name});
    if(versionMismatch)throw Error('Cần tải lại toàn bộ tiện ích để nạp bộ nền 2.5.1.');
    $('generate').disabled=true;const result=await call('PANEL_GENERATE',{payload:{items,images:$('images').checked},transport,panelId});notice('');if(transport==='embedded'){if(!result.runJob)throw Error('Bộ nền chưa trả lệnh cho khung nhúng. Cần tải lại tiện ích.');await mountFrame(result.runJob);}switchView('gpt');await load();
  }catch(e){notice(e.message,true);await load().catch(()=>{});}};
  $('cancel').onclick=async()=>{try{pendingRun=null;const id=state.panelJob?.id;await call('PANEL_CANCEL');if(frameReady&&id)$('gptFrame').contentWindow.postMessage({source:'META_STUDIO_PANEL',type:'FRAME_CANCEL',jobId:id},'https://chatgpt.com');await load();}catch(e){notice(e.message,true);}};
  $('transfer').onclick=()=>transfer(ready().map(p=>p.key));$('count').oninput=scope;$('images').onchange=footer;$('refresh').onclick=()=>load().catch(e=>notice(e.message,true));$('pageSearch').oninput=drawPages;
  $('selectAll').onclick=()=>{for(const p of state.pageCatalog?.pages||[])choices[p.id]={...(choices[p.id]||{index:0}),checked:true};drawPages();remember().catch(()=>{});};$('clearSelection').onclick=()=>{for(const choice of Object.values(choices))choice.checked=false;drawPages();remember().catch(()=>{});};
  for(const button of document.querySelectorAll('[data-target]')){button.onclick=()=>switchView(button.dataset.target);button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const buttons=[...document.querySelectorAll('[data-target]')],index=buttons.indexOf(button),next=buttons[(index+(e.key==='ArrowRight'?1:2))%buttons.length];next.focus();switchView(next.dataset.target);};}
  $('backCompose').onclick=()=>switchView('compose');$('openWeb').onclick=()=>call('PANEL_OPEN_WEB').catch(e=>notice(e.message,true));$('openGpt').onclick=()=>call('PANEL_OPEN_GPT').catch(e=>notice(e.message,true));
  $('reloadFrame').onclick=()=>{frameLoaded=false;mountFrame().catch(e=>notice(e.message,true));};
  $('fallbackTab').onclick=async()=>{try{if(busy()){await call('PANEL_SWITCH_TO_TAB');pendingRun=null;}transport='tab';await chrome.storage.local.set({studioTransport:transport});$('frameWarning').hidden=true;notice('Đang dùng tab GPT riêng. Bài và ảnh vẫn được lưu tại tiện ích.');await load();}catch(e){notice(e.message,true);}};
  $('gptMode').onchange=async e=>{if(busy()){e.target.value=state.panelJob.transport||transport;return;}transport=e.target.value==='tab'?'tab':'embedded';await chrome.storage.local.set({studioTransport:transport});await load();if(transport==='embedded'&&!frameLoaded)await mountFrame();};
  $('diagnose').onclick=async()=>{try{
    $('gptFrame').contentWindow?.postMessage({source:'META_STUDIO_PANEL',type:'FRAME_INSPECT'},'https://chatgpt.com');
    await new Promise(resolve=>setTimeout(resolve,400));const current=await call('PANEL_STATUS'),job=current.panelJob;
    const report={capturedAt:new Date().toISOString(),uiVersion:UI_VERSION,workerVersion:current.version,frame:{ready:frameReady,delivered:frameDelivered,acknowledged:frameAck,claimed:frameClaimed,navigationReady:frameNavigationReady,expectedJob:frameJobId,pending:!!pendingRun,lastInspection:lastFrameInfo},job:job?{id:job.id,status:job.status,error:job.error||'',progress:job.progress,transport:job.transport,postsReceived:job.posts?.length||0,imagesReceived:job.posts?.filter(p=>p.imageData||p.hasImage).length||0,binding:job.frameBindingInfo||null,diagnostic:job.diagnostic||null}:null};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=node('a',{href:url,download:'meta-assistant-diagnostic.json'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Đã tải báo lỗi kết nối khung GPT.');
  }catch(e){notice(e.message,true);}};
  async function checkpointBeforeUpdate(){
    for(const textarea of document.querySelectorAll('textarea[data-key]')){const post=state.panelJob?.posts.find(p=>p.key===textarea.dataset.key);if(post&&textarea.value!==post.text)await call('PANEL_EDIT',{key:post.key,text:textarea.value});}
    const settings=P.settings({gptHome:$('gptHome').value,postPrompt:$('customPostPrompt').value,imagePrompt:$('customImagePrompt').value,reddit:$('useReddit').checked});
    if(JSON.stringify(settings)!==JSON.stringify(P.settings(state.studioSettings)))await call('PANEL_SAVE_SETTINGS',{settings});
    await chrome.storage.local.set({studioChoices:choices,studioTransport:transport,studioPostCount:count(),studioImages:$('images').checked});
  }
  $('updateExtension').onclick=async()=>{
    if(busy())return;updating=true;footer();notice('Đang kiểm tra bản mới, sao lưu và cập nhật vào thư mục đang dùng…');
    try{await checkpointBeforeUpdate();const result=await call('PANEL_UPDATE',{uiVersion:UI_VERSION});
      const reloadRequired=result.reloadRequired===true||result.updated||result.version!==UI_VERSION||result.runningVersion&&result.runningVersion!==UI_VERSION;
      if(reloadRequired){notice('Đã có bản '+result.version+'. Đang nạp lại tiện ích; bản nháp được giữ nguyên…');setTimeout(()=>window.location.reload(),1200);}
      else{updating=false;$('appVersion').textContent='v'+UI_VERSION;notice('Tiện ích và giao diện đang dùng bản mới nhất '+UI_VERSION+'.');}
    }
    catch(error){updating=false;notice(error.message,true);if(/bộ cập nhật Windows|bộ kết nối/i.test(error.message))$('notice').append(node('a',{className:'updater-install',href:'https://vanxharu.github.io/quan-ly-page/meta-assistant-updater.zip',target:'_blank',rel:'noopener noreferrer',textContent:'Tải bộ kết nối Windows'}));}
    finally{footer();}
  };
  $('themeToggle').onclick=()=>call('PANEL_THEME',{theme:document.documentElement.dataset.theme==='dark'?'light':'dark'}).then(load).catch(e=>notice(e.message,true));
  chrome.storage.onChanged.addListener((_changes,area)=>{if(area==='local'){clearTimeout(loadTimer);loadTimer=setTimeout(()=>load().catch(e=>notice(e.message,true)),100);}});
  (async()=>{const prefs=await chrome.storage.local.get(['studioChoices','studioTransport','studioPostCount','studioImages']);if(prefs.studioPostCount)$('count').value=Math.max(1,Math.trunc(Number(prefs.studioPostCount))||1);if(typeof prefs.studioImages==='boolean')$('images').checked=prefs.studioImages;choices=prefs.studioChoices||{};transport=prefs.studioTransport==='tab'?'tab':'embedded';await call('PANEL_ATTACH',{panelId}).catch(()=>{});await load();switchView('compose');})().catch(e=>notice(e.message,true));
})();
