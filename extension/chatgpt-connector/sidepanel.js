(() => {
  const $=id=>document.getElementById(id),panelId=crypto.randomUUID();
  let state={},catalogStamp=0,choices={},loadTimer,view='compose',transport='embedded',frameReady=false,frameLoaded=false,frameDelivered=false,pendingRun=null,frameTimer;
  const node=(tag,props={},...children)=>{const el=document.createElement(tag);Object.assign(el,props);el.append(...children.filter(x=>x!=null));return el;};
  const call=async(type,extra={})=>{const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error(r?.error||'Tiện ích chưa sẵn sàng.');return r;};
  const busy=()=>['opening','running'].includes(state.panelJob?.status)||state.externalRunning;
  const ready=()=>state.panelJob?.posts?.filter(p=>!p.transferredAt&&(state.panelJob.completedKeys?.includes(p.key)||!['opening','running'].includes(state.panelJob.status)&&p.text?.trim()))||[];
  const count=()=>Math.max(1,Math.min(3,Math.trunc(Number($('count').value))||1));
  const selected=()=>(state.pageCatalog?.pages||[]).filter(p=>choices[p.id]?.checked);
  const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase();
  function notice(text,error=false){$('notice').hidden=!text;$('notice').textContent=text||'';$('notice').className=error?'error':'';}
  function avatar(page,small=false){const el=node('span',{className:'avatar'+(small?' small':''),textContent:(page.name||'Page').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()});if(page.avatar){const img=node('img',{src:page.avatar,alt:'',loading:'lazy',referrerPolicy:'no-referrer',onerror:()=>img.remove()});el.append(img);}return el;}
  function applyTheme(){const theme=state.studioTheme||state.pageCatalog?.theme||'light';document.documentElement.dataset.theme=theme;if(frameReady&&frameLoaded)$('gptFrame').contentWindow.postMessage({source:'META_STUDIO_PANEL',type:'FRAME_THEME',theme},'https://chatgpt.com');$('themeToggle').textContent=theme==='dark'?'☼':'☾';$('themeToggle').title=theme==='dark'?'Chuyển sang sáng, đồng bộ với web':'Chuyển sang tối, đồng bộ với web';}
  function footer(){const n=ready().length,active=busy();$('generate').hidden=view!=='compose'||!!n;$('generate').disabled=!!active||!!n;$('generate').textContent=active?'Đang tạo…':`✦ Tạo${selected().length?' '+selected().length*count():''} ${$('images').checked?'bài & ảnh':'bài viết'}`;$('transfer').hidden=view==='compose'&&!n;$('transfer').disabled=!n||!!state.pendingTransfer;$('transfer').textContent=state.pendingTransfer?'Đang chờ web xác nhận…':n?`Đưa ${n} bản nháp sang web ↗`:'Chưa có bài sẵn sàng';$('cancel').hidden=!active;$('transferHint').textContent=n?'Giữ đúng Page · Chuyển vào danh sách chờ duyệt':active?((state.panelJob?.transport||transport)==='embedded'?'Giữ bảng mở khi GPT đang tạo · Nháp tự lưu':'Đang xử lý · Không giới hạn thời gian chờ'):'Tạo từng bài + ảnh · Lưu trước khi tạo tiếp';}
  function scope(){$('selectedCount').textContent=`${selected().length} Page đã chọn`;$('scope').textContent=`${selected().length} Page × ${count()} bài = ${selected().length*count()} bài riêng. Tối đa 6 bài/lượt.`;footer();}
  async function remember(){await chrome.storage.local.set({studioChoices:choices});scope();}
  function drawPages(){
    const pages=state.pageCatalog?.pages||[],search=normalized($('pageSearch').value);
    $('catalogHint').textContent=pages.length?'':'Mở website và đăng nhập Page để đồng bộ avatar, hồ sơ và chủ đề.';
    const visible=pages.filter(p=>normalized(p.name+' '+p.id).includes(search));
    $('pages').replaceChildren(...visible.map(page=>{
      const choice=choices[page.id]||(choices[page.id]={checked:page.selected,index:Math.max(0,page.topics.findIndex(t=>Number(t.day)===new Date().getDay()))});if(choice.index>=page.topics.length)choice.index=0;
      const card=node('div',{className:'page'+(choice.checked?' selected':'')});
      const select=node('select',{disabled:!!busy(),onchange:e=>{choice.index=Number(e.target.value);remember().catch(e=>notice(e.message,true));}},...page.topics.map((t,i)=>node('option',{value:String(i),textContent:`${t.dayLabel||''} · ${t.title||'Chủ đề'}`,selected:i===choice.index})));select.setAttribute('aria-label','Chủ đề cho '+page.name);
      const field=node('label',{className:'topic-field',hidden:!choice.checked},'Chủ đề của Page',select);
      const check=node('input',{type:'checkbox',checked:choice.checked,disabled:!!busy(),onchange:e=>{choice.checked=e.target.checked;card.className='page'+(choice.checked?' selected':'');field.hidden=!choice.checked;remember().catch(e=>notice(e.message,true));}});
      const info=node('span',{className:'page-info'},node('strong',{textContent:page.name,title:page.name}),node('span',{textContent:'Page · …'+page.id.slice(-6)}));
      card.append(node('label',{className:'page-label'},avatar(page),info,check),field);return card;
    }));if(!visible.length&&pages.length)$('pages').append(node('p',{className:'hint',textContent:'Không tìm thấy Page phù hợp.'}));scope();
  }
  function switchView(target){
    view=target;for(const button of document.querySelectorAll('[data-target]'))button.setAttribute('aria-selected',String(button.dataset.target===target));
    $('composeView').hidden=target!=='compose';$('draftsView').hidden=target!=='drafts';
    $('gptView').hidden=target!=='gpt'&&!frameLoaded;$('gptView').classList.toggle('offscreen',target!=='gpt'&&frameLoaded);$('gptView').setAttribute('aria-hidden',String(target!=='gpt'));$('gptFrame').tabIndex=target==='gpt'?0:-1;
    $('workspace').classList.toggle('chat-active',target==='gpt');footer();
    if(target==='gpt'&&transport==='embedded'&&!frameLoaded)mountFrame().catch(e=>{notice(e.message,true);$('frameWarning').hidden=false;});
  }
  function postRun(){if(!frameReady||!pendingRun||frameDelivered)return;frameDelivered=true;$('gptFrame').contentWindow.postMessage({source:'META_STUDIO_PANEL',type:'FRAME_RUN',job:pendingRun},'https://chatgpt.com');pendingRun=null;}
  async function mountFrame(runJob=null){
    await call('PANEL_PREPARE_EMBED');if(frameLoaded&&!runJob)return;
    pendingRun=runJob;frameDelivered=false;frameReady=false;frameLoaded=true;$('frameDot').classList.remove('ready');$('frameWarning').hidden=true;$('frameCover').hidden=false;$('frameStatus').textContent='Đang kết nối GPT…';
    $('gptFrame').src='https://chatgpt.com/'+(runJob?'?meta_studio_job='+encodeURIComponent(runJob.id):'');
    clearTimeout(frameTimer);frameTimer=setTimeout(()=>{if(!frameReady){$('frameStatus').textContent='Khung GPT chưa phản hồi';$('frameWarning').hidden=false;$('frameCover').hidden=true;}},15000);switchView(view);
  }
  window.addEventListener('message',event=>{
    if(event.origin!=='https://chatgpt.com'||event.source!==$('gptFrame').contentWindow||event.data?.source!=='META_STUDIO_GPT_FRAME'||event.data.type!=='FRAME_READY')return;
    if(pendingRun&&event.data.loadKey!==pendingRun.id)return;
    frameReady=true;clearTimeout(frameTimer);$('frameStatus').textContent='Đã kết nối GPT';$('frameDot').classList.add('ready');$('frameCover').hidden=true;$('frameWarning').hidden=true;applyTheme();postRun();
  });
  async function transfer(keys){try{notice('Đang chuyển bản nháp sang web…');await call('PANEL_TRANSFER',{keys});notice('Đã mở web. Bản nháp được giữ tại đây đến khi web xác nhận.');await load();}catch(e){notice(e.message,true);}}
  function drawResults(){
    if(document.activeElement?.matches('textarea[data-key]'))return;
    const job=state.panelJob,posts=job?.posts||[];$('navCount').textContent=String(posts.length);$('draftCount').textContent=posts.length?`${job.completedKeys?.length||0}/${job.input.items.length} bài đã hoàn tất · Giữ đúng Page`:'Bài và ảnh được lưu ngay trong tiện ích.';$('empty').hidden=!!posts.length;
    $('results').replaceChildren(...posts.map((post,index)=>{
      const complete=job.completedKeys?.includes(post.key),canTransfer=complete||!['opening','running'].includes(job.status)&&!!post.text?.trim(),page=state.pageCatalog?.pages.find(p=>p.id===post.pageId)||{name:post.pageName};
      const card=node('article',{className:'draft'});card.append(node('div',{className:'draft-header'},avatar(page,true),node('div',{},node('h2',{textContent:post.pageName}),node('p',{textContent:post.topicTitle||'Bài '+(index+1)}))));
      card.append(node('span',{className:'pill',textContent:post.transferredAt?'Đã chuyển sang web':complete?'Đã lưu · Sẵn sàng chuyển':busy()?'Đang hoàn thiện bài & ảnh':'Bản nháp chưa đủ ảnh'}),node('p',{className:'draft-preview',textContent:post.text}));
      if(post.imageData)card.append(node('img',{className:'draft-image',src:post.imageData,alt:'Ảnh bài '+(index+1)}));
      const text=node('textarea',{value:post.text,rows:6,readOnly:!!busy(),onchange:async e=>{try{await call('PANEL_EDIT',{key:post.key,text:e.target.value});}catch(err){notice(err.message,true);}},onblur:()=>setTimeout(()=>load().catch(()=>{}),100)});text.dataset.key=post.key;text.setAttribute('aria-label','Sửa bài '+(index+1));
      card.append(node('details',{},node('summary',{textContent:busy()?'Xem nội dung đầy đủ':'Chỉnh sửa nội dung'}),text));
      if(post.imageError)card.append(node('p',{className:'hint',textContent:'Ảnh: '+post.imageError}));
      card.append(node('button',{className:'secondary',disabled:!canTransfer,textContent:post.transferredAt?'Mở lại trên web ↗':'Đưa bài này sang web ↗',onclick:()=>transfer([post.key])}));return card;
    }));
  }
  async function load(){
    state=await call('PANEL_STATUS');applyTheme();if(catalogStamp!==state.pageCatalog?.updatedAt){catalogStamp=state.pageCatalog?.updatedAt;drawPages();}
    const job=state.panelJob,active=busy();document.querySelectorAll('#pages input,#pages select').forEach(el=>el.disabled=!!active);$('selectAll').disabled=$('clearSelection').disabled=!!active;
    $('gptMode').disabled=!!active;$('reloadFrame').disabled=!!active;$('progressBox').hidden=(!job&&!state.externalRunning)||(!active&&job?.status==='done');$('progressBox').dataset.state=job?.status||'';
    $('progressTitle').textContent=active?'Đang tạo nội dung':job?.status==='error'?'Lượt tạo cần kiểm tra':'Bản nháp đã lưu';const total=job?.input.items.length||1,complete=job?.completedKeys?.length||0;$('progress').value=Math.round(100*complete/total);$('loading').hidden=!active;$('progressCount').textContent=`${complete}/${job?.input.items.length||0}`;
    const label=state.externalRunning?'Có lượt đang chạy từ web. Bấm Dừng để chuyển sang Studio AI.':job?.error||job?.progress||'';$('progressText').textContent=label;$('progressText').title=label;
    const currentMode=active&&job?.transport?job.transport:transport;$('gptMode').value=currentMode;$('frameWrap').hidden=currentMode==='tab';$('tabModeHint').hidden=currentMode!=='tab';drawResults();footer();
  }
  $('generate').onclick=async()=>{try{
    const pages=selected(),n=count();if(!pages.length)throw Error('Chọn ít nhất một Page.');if(pages.length*n>6)throw Error('Tối đa 6 bài/lượt. Giảm số Page hoặc số bài.');
    const items=[];for(const page of pages){const topic=page.topics[choices[page.id].index];if(!topic?.title)throw Error('Page '+page.name+' chưa có chủ đề. Chỉnh trong tab Chủ đề trên web.');for(let i=0;i<n;i++){const profile=page.profile,brief=`Page: ${page.name}\nNgành / sản phẩm: ${profile.niche}\nKhách hàng: ${profile.audience}\nChủ đề: ${topic.title}\nPhong cách: ${topic.style}\nĐịnh hướng: ${topic.direction}\nYêu cầu bài: ${topic.postPrompt}\nYêu cầu ảnh: ${topic.imagePrompt}\nThông tin bổ sung: ${$('brief').value.trim()}\nBài ${i+1}/${n} cho đúng Page này. Ảnh dọc 4:5, có tiêu đề và Liên hệ: 0899779488, chữ dưới 25%; bài có 2–3 hashtag. Chỉ dùng thông tin thực tế.`;items.push({key:'post-'+crypto.randomUUID(),pageId:page.id,pageName:page.name,topicTitle:topic.title,brief,tone:profile.voice||topic.style||'Thân thiện, tự nhiên'});}}
    $('generate').disabled=true;const result=await call('PANEL_GENERATE',{payload:{items,images:$('images').checked},transport,panelId});notice('');if(transport==='embedded')await mountFrame(result.runJob);switchView('gpt');await load();
  }catch(e){notice(e.message,true);await load().catch(()=>{});}};
  $('cancel').onclick=async()=>{try{pendingRun=null;const id=state.panelJob?.id;await call('PANEL_CANCEL');if(frameReady&&id)$('gptFrame').contentWindow.postMessage({source:'META_STUDIO_PANEL',type:'FRAME_CANCEL',jobId:id},'https://chatgpt.com');await load();}catch(e){notice(e.message,true);}};
  $('transfer').onclick=()=>transfer(ready().map(p=>p.key));$('count').oninput=scope;$('images').onchange=footer;$('refresh').onclick=()=>load().catch(e=>notice(e.message,true));$('pageSearch').oninput=drawPages;
  $('selectAll').onclick=()=>{for(const p of state.pageCatalog?.pages||[])choices[p.id]={...(choices[p.id]||{index:0}),checked:true};drawPages();remember().catch(()=>{});};$('clearSelection').onclick=()=>{for(const choice of Object.values(choices))choice.checked=false;drawPages();remember().catch(()=>{});};
  for(const button of document.querySelectorAll('[data-target]')){button.onclick=()=>switchView(button.dataset.target);button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const buttons=[...document.querySelectorAll('[data-target]')],index=buttons.indexOf(button),next=buttons[(index+(e.key==='ArrowRight'?1:2))%3];next.focus();switchView(next.dataset.target);};}
  $('backCompose').onclick=()=>switchView('compose');$('openWeb').onclick=()=>call('PANEL_OPEN_WEB').catch(e=>notice(e.message,true));$('openGpt').onclick=()=>call('PANEL_OPEN_GPT').catch(e=>notice(e.message,true));
  $('reloadFrame').onclick=()=>{frameLoaded=false;mountFrame().catch(e=>notice(e.message,true));};
  $('fallbackTab').onclick=async()=>{try{if(busy()){await call('PANEL_SWITCH_TO_TAB');pendingRun=null;}transport='tab';await chrome.storage.local.set({studioTransport:transport});$('frameWarning').hidden=true;notice('Đang dùng tab GPT riêng. Bài và ảnh vẫn được lưu tại tiện ích.');await load();}catch(e){notice(e.message,true);}};
  $('gptMode').onchange=async e=>{if(busy()){e.target.value=state.panelJob.transport||transport;return;}transport=e.target.value==='tab'?'tab':'embedded';await chrome.storage.local.set({studioTransport:transport});await load();if(transport==='embedded'&&!frameLoaded)await mountFrame();};
  $('themeToggle').onclick=()=>call('PANEL_THEME',{theme:document.documentElement.dataset.theme==='dark'?'light':'dark'}).then(load).catch(e=>notice(e.message,true));
  chrome.storage.onChanged.addListener((_changes,area)=>{if(area==='local'){clearTimeout(loadTimer);loadTimer=setTimeout(()=>load().catch(e=>notice(e.message,true)),100);}});
  (async()=>{const prefs=await chrome.storage.local.get(['studioChoices','studioTransport']);choices=prefs.studioChoices||{};transport=prefs.studioTransport==='tab'?'tab':'embedded';await call('PANEL_ATTACH',{panelId});await load();switchView('compose');})().catch(e=>notice(e.message,true));
})();
