/* Soạn bài/ảnh qua tab ChatGPT và tiện ích kết nối; kết quả chỉ thành bản nháp. */
(() => {
  const pending=new Map();let dialog=null,current=null,busy=false,session=null,targets=[],choices={},connectorVersion=null,connectorReady=false;
  function studioVersionOK(version){const parts=String(version||'').split('.').map(Number),minimum=[2,1,0];if(parts.length!==3||parts.some(p=>!Number.isInteger(p)||p<0))return false;for(let i=0;i<3;i++){if(parts[i]!==minimum[i])return parts[i]>minimum[i];}return true;}
  const send=(type,payload)=>new Promise((resolve,reject)=>{
    const id=uid('ai');const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Cần tiện ích 2.1.0 để tạo từng bài và lưu chờ duyệt. Cập nhật tiện ích rồi tải lại trang.'));},4000);
    pending.set(id,{resolve,reject,timeout});window.postMessage({source:'META_ASSISTANT_AI_V106',type,id,payload},location.origin);
  });
  const safePosts=posts=>(Array.isArray(posts)?posts:[]).slice(0,6).filter(p=>p&&typeof p.key==='string').map(p=>({
    key:p.key.slice(0,80),topicTitle:String(p.topicTitle||'').slice(0,300),pageId:String(p.pageId||'').slice(0,40),pageName:String(p.pageName||'').slice(0,300),
    text:String(p.text||'').slice(0,18000),imagePrompt:String(p.imagePrompt||'').slice(0,5000),
    imageData:typeof p.imageData==='string'&&p.imageData.length<=600000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.imageData)?p.imageData:'',
    imageError:String(p.imageError||'').slice(0,500)
  }));
  function mergePosts(incoming){return safePosts(incoming).map(post=>{const assigned=session?.items?.find(x=>x.key===post.key);if(assigned)post={...post,pageId:assigned.pageId,pageName:assigned.pageName,topicTitle:assigned.topicTitle};const previous=session?.posts?.find(x=>x.key===post.key);return previous?{...post,...(previous._editedText?{text:previous.text,_editedText:true}:{}),...(previous._editedImage?{imageData:previous.imageData,imageError:'',_editedImage:true}:{})}:post;});}
  const save=async()=>{if(session){await DB.set('aiDraftSessionV1',session);window.dispatchEvent(new Event('ai-drafts-updated'));}};
  let reviewWrites=Promise.resolve();
  function persistReview(){
    const snapshot=structuredClone(session);
    reviewWrites=reviewWrites.catch(()=>{}).then(async()=>{
      const queue=await DB.get('fbScheduleQueueV1',[]);
      for(const post of snapshot.posts||[]){
        const sourceId=snapshot.id+'|'+post.key;let item=queue.find(x=>x.aiSourceId===sourceId);
        const generating=!!snapshot.hasImages&&!post.imageData&&!post.imageError;
        if(!item){item={id:uid('fs'),pageKey:post.pageId,pageName:post.pageName,text:post.text,imageData:post.imageData||'',at:0,status:'draft',createdAt:Date.now(),source:'chatgpt',topicTitle:post.topicTitle||'',aiSourceId:sourceId};queue.push(item);}
        if(item.status==='draft'){
          if(item.aiOriginalText===undefined||item.text===item.aiOriginalText)item.text=post.text;
          if(item.aiOriginalImage===undefined||item.imageData===item.aiOriginalImage)item.imageData=post.imageData||'';
          item.aiOriginalText=post.text;item.aiOriginalImage=post.imageData||'';item.aiGenerating=generating;item.imageError=post.imageError||'';
        }
      }
      await DB.set('fbScheduleQueueV1',queue);App.tabs.planner?.refresh();
    });return reviewWrites;
  }
  async function acknowledgeReview(key){if(!key)return;await persistReview();await send('DRAFT_SAVED',{jobId:session.id,key});}
  let importBusy=false,catalogTimer;
  function studioAvatar(page){try{const url=new URL(App.pageAvatarUrl(page));if(url.protocol!=='https:'||url.username||url.password)return '';for(const key of ['access_token','token','authorization','auth'])url.searchParams.delete(key);return url.href;}catch{return '';}}
  async function syncCatalog(){
    if(!App.pages?.length)return;
    const pages=await Promise.all(App.pages.map(async page=>{const data=await App.topics.load(page.id);return {id:page.id,name:page.name,avatar:studioAvatar(page),selected:App.selected().some(p=>p.id===page.id),profile:{niche:data.profile.niche||'',audience:data.profile.audience||'',voice:data.profile.voice||''},topics:data.topics};}));
    await send('CATALOG_SYNC',{pages,theme:document.body.classList.contains('dark-mode')?'dark':'light'});
  }
  function queueCatalog(){clearTimeout(catalogTimer);catalogTimer=setTimeout(()=>syncCatalog().catch(()=>{}),250);}
  async function importPanel(){
    if(importBusy||!App.pages?.length)return;importBusy=true;
    try{
      const result=await send('TRANSFER_PULL'),transfer=result.transfer;if(!transfer)return;
      const posts=safePosts(transfer.posts);if(!posts.length)throw Error('Không có bài để nhận.');
      for(const post of posts)if(!App.pageById(post.pageId))throw Error('Kết nối Page '+post.pageName+' trước khi nhận bài từ tiện ích.');
      const snapshot=posts.map(p=>({...p}));
      reviewWrites=reviewWrites.catch(()=>{}).then(async()=>{
        const queue=await DB.get('fbScheduleQueueV1',[]);
        for(const post of snapshot){const sourceId=transfer.sourceJobId+'|'+post.key;const existing=queue.find(x=>x.aiSourceId===sourceId);
          if(existing){if(existing.status==='draft'){if(existing.aiOriginalText!==undefined&&existing.text===existing.aiOriginalText)existing.text=post.text;if(existing.aiOriginalImage!==undefined&&existing.imageData===existing.aiOriginalImage)existing.imageData=post.imageData;existing.aiOriginalText=post.text;existing.aiOriginalImage=post.imageData;}continue;}
          queue.push({id:uid('fs'),pageKey:post.pageId,pageName:App.pageById(post.pageId).name,text:post.text,imageData:post.imageData,at:0,status:'draft',createdAt:Date.now(),source:'chatgpt-extension',topicTitle:post.topicTitle||'',aiSourceId:sourceId,aiOriginalText:post.text,aiOriginalImage:post.imageData,aiGenerating:false});
        }
        await DB.set('fbScheduleQueueV1',queue);
      });await reviewWrites;
      await send('TRANSFER_ACK',{id:transfer.id});window.dispatchEvent(new Event('ai-drafts-updated'));
      App.setSelected([...new Set([...App.selected().map(p=>p.id),...posts.map(p=>p.pageId)])]);App.show('planner');await App.tabs.planner?.refresh();toast('Đã nhận '+posts.length+' bài từ tiện ích vào Lịch đăng · Chờ duyệt.',6000);
    }catch(error){toast('Nhận bài từ tiện ích: '+error.message,6000);}finally{importBusy=false;}
  }
  async function openStudio(){
    syncCatalog().catch(()=>{});
    try{const state=await send('STATUS');if(studioVersionOK(state.version)){toast('Studio AI mở ở bên cạnh. Bạn cũng có thể bấm biểu tượng tiện ích để mở lại.',5000);return;}}catch{}
    const help=h('dialog',{className:'ai-dialog'});help.append(h('h2',{textContent:'Mở Studio AI bên cạnh'}),h('p',{textContent:'Cập nhật tiện ích lên 2.1.0, bấm Tải lại tại chrome://extensions rồi tải lại trang này. Sau đó bấm biểu tượng tiện ích Meta Assistant để mở bảng tạo bài.'}),h('a',{className:'btn btn-primary',href:'chatgpt-connector.zip?v=2.1.0',download:'meta-assistant-chatgpt-connector.zip',textContent:'Tải tiện ích Studio AI 2.1.0'}),h('button',{className:'btn btn-ghost',textContent:'Đóng',onclick:()=>help.close()}));document.body.append(help);help.addEventListener('close',()=>help.remove());help.showModal();
  }
  window.addEventListener('meta-theme-changed',()=>send('THEME_SYNC',{theme:document.body.classList.contains('dark-mode')?'dark':'light'}).catch(()=>{}));
  App.onLogin.push(()=>{queueCatalog();importPanel().catch(()=>{});});App.onPageChange.push(queueCatalog);
  setTimeout(queueCatalog,1500);setInterval(()=>{if(!document.hidden)importPanel().catch(()=>{});},4000);
  window.addEventListener('message',async e=>{
    const m=e.data;if(e.source!==window||e.origin!==location.origin||m?.source!=='META_AI_CONNECTOR_V106')return;
    if(m.type==='REPLY'&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timeout);pending.delete(m.id);m.ok?p.resolve(m):p.reject(Error(m.error||'Tiện ích chưa sẵn sàng.'));return;}
    if(m.type==='THEME_CHANGED'){setDark(m.theme==='dark');return;}
    if(m.type==='BRIDGE_READY'){queueCatalog();importPanel().catch(()=>{});return;}
    if(m.type==='PANEL_IMPORT_READY'){await importPanel();return;}
    if(!session)session=await DB.get('aiDraftSessionV1',null);
    if(!session||m.id!==session.id)return;
    if(m.type==='PROGRESS'){session.progress=String(m.text||'').slice(0,500);const text=session.progress;let percent=session.percent||5;
      if(/soạn nội dung/i.test(text))percent=Math.max(percent,20);
      else if(/tạo ảnh\s+(\d+)\s*\/\s*(\d+)/i.test(text)){const match=text.match(/tạo ảnh\s+(\d+)\s*\/\s*(\d+)/i);percent=Math.max(percent,Math.round(35+55*(Number(match[1])-1)/Math.max(1,Number(match[2]))));}
      else if(/mở tab|đang mở/i.test(text))percent=Math.max(percent,8);
      session.percent=percent;await save();renderProgress(session.progress,percent,true);status(session.progress,'working');return;}
    if(['PARTIAL','RESULT'].includes(m.type)){
      session.posts=mergePosts(m.posts);session.error=String(m.error||'').slice(0,1000);
      const received=session.posts.filter(p=>p.text||p.imageData||p.imageError).length,total=Math.max(1,session.items?.length||session.posts.length||1);
      const images=session.posts.filter(p=>p.imageData||p.imageError).length;session.percent=Math.max(session.percent||10,Math.min(95,Math.round(10+85*(received+(session.hasImages?images:0))/(total*(session.hasImages?2:1)))));if(m.type==='PARTIAL')session.progress=`Đã lưu ${received}/${total} bài`+(session.hasImages?` · ${images}/${total} ảnh`:'')+'. Đang tiếp tục…';
      if(m.type==='RESULT'){busy=false;session.done=true;session.percent=m.error?Math.min(session.percent||0,95):100;session.progress=m.error?'Đã dừng. Các kết quả đã nhận vẫn được giữ.':'Hoàn tất — đã nhận bài và ảnh. Xem lại trước khi sử dụng.';}
      await save();try{await persistReview();if(m.reviewKey)await send('DRAFT_SAVED',{jobId:session.id,key:m.reviewKey});}catch(e){status('Chưa lưu vào danh sách duyệt: '+e.message,'error');return;}renderResults();renderProgress(session.progress,session.percent,busy);status(session.error||session.progress,session.error?'error':busy?'working':'success');updateButtons();
      if(!dialog?.open)toast(m.type==='RESULT'?'ChatGPT đã trả kết quả. Mở AI soạn bài để xem.':'Đã nhận nội dung từ ChatGPT.',5000);
    }
  });
  const status=(text,tone='info')=>{const el=$('aiStatus');if(el){el.textContent=text||'';el.dataset.tone=tone;}};
  function renderProgress(label,percent,active){const box=$('aiProgressBox');if(!box)return;box.hidden=!label;box.dataset.active=String(!!active);const bar=$('aiProgress');if(bar)bar.value=Math.max(0,Math.min(100,Number(percent)||0));const title=$('aiProgressLabel');if(title)title.textContent=label||'';const value=$('aiProgressValue');if(value)value.textContent=`${Math.max(0,Math.min(100,Number(percent)||0))}%`;}
  function connection(connected){
    connectorReady=connected===true&&studioVersionOK(connectorVersion);
    const outdated=connected===true&&!connectorReady;
    const el=$('aiConnection');el.dataset.state=connected===null?'checking':outdated?'outdated':connected?'connected':'disconnected';
    $('aiConnectionText').textContent=connected===null?'Đang kiểm tra tiện ích…':outdated?`Tiện ích ${connectorVersion} cần cập nhật bộ đọc nội dung ChatGPT`:connected?`Tiện ích ${connectorVersion} đã kết nối`:'Chưa kết nối tiện ích';
    $('aiInstall').hidden=connected===true&&!outdated;
    if(connected===true&&!outdated)$('aiInstall').open=false;
    else if(connected===false||outdated)$('aiInstall').open=true;
  }
  function updateButtons(){if($('aiGenerate'))$('aiGenerate').disabled=busy||!connectorReady;if($('aiCancel'))$('aiCancel').hidden=!busy;dialog?.querySelectorAll('#aiPageTargets input,#aiPageTargets select,#aiTopicMode,#aiCount').forEach(b=>b.disabled=busy);}
  function updateScope(){const n=targets.filter(t=>t.checked).length,count=current?.mode==='planner'?Math.max(1,Math.min(3,Number($('aiCount').value)||1)):1;$('aiScope').textContent=`${n} Page × ${count} bài = ${n*count} bài riêng. Tạo bài → tạo ảnh → lưu chờ duyệt → mới tạo bài tiếp. Tối đa 6 bài/lượt.`;}
  function drawTargets(){
    const useTopics=$('aiTopicMode').checked;
    $('aiBriefLabel').textContent=useTopics?'Yêu cầu bổ sung (tuỳ chọn)':'Chủ đề / yêu cầu';
    $('aiBrief').placeholder=useTopics?'Thêm sản phẩm, giá hoặc ưu đãi có thật cần nhắc đến. Để trống để dùng chủ đề đã chọn.':'Nhập thông tin và yêu cầu bài viết…';
    $('aiPageTargets').replaceChildren(...targets.map(target=>{
      const p=target.page,topic=target.data.topics[target.topicIndex];
      const select=h('select',{'aria-label':'Chủ đề cho '+p.name,value:String(target.topicIndex),onchange:e=>{target.topicIndex=Number(e.target.value);choices[p.id]=target.data.topics[target.topicIndex]?.day;DB.set('aiTopicChoicesV1',choices).catch(()=>{});drawTargets();}},...target.data.topics.map((t,i)=>h('option',{value:String(i),textContent:`${t.dayLabel} · ${t.title}`,selected:i===target.topicIndex})));
      return h('div',{className:'ai-page-card',dataset:{pageId:p.id,checked:String(target.checked)}},
        h('div',{className:'row'},h('label',{className:'row grow'},h('input',{type:'checkbox',checked:target.checked,'aria-label':'Tạo bài cho '+p.name,onchange:e=>{target.checked=e.target.checked;drawTargets();}}),App.avatar(p.name,App.pageAvatarUrl(p),26),h('strong',{textContent:p.name})),
          h('button',{type:'button',className:'btn btn-ghost btn-sm',textContent:'Sửa chủ đề',onclick:()=>{dialog.close();App.topics.open(p.id);}})),
        useTopics?h('div',{className:'field section-gap'},select):null,
        useTopics?h('details',{className:'ai-topic-preview'},h('summary',{textContent:target.data.inherited?'Đang dùng mẫu chung · Xem nội dung & ảnh':'Chủ đề riêng của Page · Xem nội dung & ảnh'}),
          h('p',{textContent:'Bài: '+(topic?.direction||topic?.postPrompt||topic?.title||'Chưa có chủ đề')}),h('p',{textContent:'Ảnh: '+(topic?.imagePrompt||'Minh hoạ theo nội dung và ngành hàng của Page.')}),h('p',{textContent:'Ngành / sản phẩm: '+(target.data.profile.niche||'Chưa có hồ sơ — bổ sung trong tab Chủ đề.')})):null);
    }));updateScope();updateButtons();
  }
  async function diagnose(){
    const button=$('aiDiagnose');if(button)button.disabled=true;
    try{
      const state=await send('STATUS'),job=state.job;
      const report={capturedAt:new Date().toISOString(),connectorVersion:state.version||'',job:job?{id:job.id,status:job.status,error:job.error||'',progress:job.progress,postsReceived:job.posts?.length||0,imagesReceived:job.posts?.filter(p=>p.imageData).length||0,reviewKey:job.reviewKey||'',diagnostic:job.diagnostic||null}:null};
      $('aiDiagnosticResult').textContent=JSON.stringify(report,null,2);$('aiDiagnosticResult').hidden=false;
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
      const link=h('a',{href:url,download:'meta-assistant-diagnostic.json'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast('Đã tải báo lỗi. Báo lỗi không chứa bài viết, ảnh, mật khẩu hay token.',7000);
    }catch(e){$('aiDiagnosticResult').textContent='Không lấy được trạng thái: '+e.message;$('aiDiagnosticResult').hidden=false;}
    finally{if(button)button.disabled=false;}
  }
  function ensureDialog(){
    if(dialog)return;
    dialog=h('dialog',{className:'ai-dialog','aria-labelledby':'aiDialogTitle'});
    dialog.append(h('div',{className:'ai-dialog-head'},h('div',{},h('h2',{id:'aiDialogTitle',textContent:'AI soạn bài & tạo ảnh'}),h('p',{className:'muted',textContent:'Nhập chủ đề → ChatGPT tạo bài trong tab riêng → nhận bản nháp tại đây.'})),h('button',{type:'button',className:'icon-btn','aria-label':'Đóng trợ lý',textContent:'×',onclick:()=>dialog.close()})),
      h('div',{id:'aiConnection',className:'ai-connection',role:'status'},h('span',{id:'aiConnectionText',textContent:'Đang kiểm tra tiện ích…'}),h('button',{type:'button',className:'btn btn-ghost',textContent:'Kiểm tra lại',onclick:checkConnection})),
      h('details',{id:'aiInstall',className:'ai-install'},h('summary',{textContent:'Cập nhật / kết nối tiện ích ChatGPT'}),h('p',{textContent:'Tải và giải nén bản mới. Trong Chrome, mở chrome://extensions, chọn Tải lại trên tiện ích cũ sau khi thay các tệp trong thư mục, hoặc chọn Tải tiện ích đã giải nén nếu dùng thư mục mới. Sau đó tải lại trang này.'}),
        h('a',{className:'btn btn-ghost',href:'chatgpt-connector.zip?v=2.1.0',download:'meta-assistant-chatgpt-connector.zip',textContent:'Tải tiện ích kết nối'}),h('p',{className:'hint',textContent:'Tiện ích cần truy cập ChatGPT, ảnh ChatGPT và trang Meta Assistant này. Không dùng quyền gỡ lỗi. Giữ tab ChatGPT mở khi tạo bài.'})),
      h('label',{className:'row section-gap'},h('input',{id:'aiTopicMode',type:'checkbox',checked:true,onchange:drawTargets}),'Dùng chủ đề đã lưu cho từng Page'),
      h('div',{id:'aiPageTargets',className:'ai-page-targets',role:'group','aria-label':'Chọn Page và chủ đề'}),
      h('div',{className:'form-grid'},
        h('label',{className:'field wide'},h('span',{id:'aiBriefLabel',textContent:'Yêu cầu bổ sung (tuỳ chọn)'}),h('textarea',{id:'aiBrief',rows:2,maxLength:1500})),
        h('label',{className:'field'},'Giọng văn',h('select',{id:'aiTone'},...['Theo hồ sơ từng Page','Thân thiện, tự nhiên','Chuyên nghiệp','Ngắn gọn, rõ ràng','Gần gũi, kể chuyện'].map(t=>h('option',{value:t,textContent:t})))),
        h('label',{className:'field',id:'aiCountField'},'Số bài cho mỗi Page',h('input',{id:'aiCount',type:'number',min:1,max:3,value:1,oninput:updateScope}))),
      h('div',{className:'row section-gap'},h('label',{className:'row',style:'gap:7px'},h('input',{id:'aiImages',type:'checkbox',checked:true}),'Tạo thêm ảnh minh hoạ'),h('span',{className:'hint',textContent:'Ảnh dọc 4:5 sắc nét · Rà soát chữ tiếng Việt · Chữ dưới 25% · 0899779488.'})),
      h('div',{id:'aiScope',className:'hint section-gap'}),
      h('div',{className:'row section-gap'},h('button',{id:'aiGenerate',type:'button',className:'btn btn-primary','data-ai-generate':'1',textContent:'Tạo bằng ChatGPT',onclick:generate}),h('button',{id:'aiCancel',type:'button',hidden:true,className:'btn btn-ghost',textContent:'Dừng nhận kết quả',onclick:async()=>{try{await send('CANCEL');}catch(e){status(e.message);}}})),
      h('div',{id:'aiProgressBox',className:'ai-progress-box section-gap',hidden:true},h('div',{className:'ai-progress-head'},h('span',{id:'aiProgressLabel',textContent:'Đang chuẩn bị…'}),h('strong',{id:'aiProgressValue',textContent:'0%'})),h('div',{className:'ai-progress-track'},h('progress',{id:'aiProgress',max:100,value:0, 'aria-label':'Tiến độ tạo bài'}),h('span',{className:'ai-progress-sweep','aria-hidden':'true'})),h('p',{className:'hint',textContent:'Chờ đến khi ChatGPT hoàn tất, không giới hạn thời gian. Từng bài được tự lưu ngay; ảnh được bổ sung khi tạo xong.'})),
      h('div',{className:'section-gap'},h('button',{id:'aiDiagnose',type:'button',className:'btn btn-ghost',textContent:'Kiểm tra lượt đang chạy / Tải báo lỗi',onclick:diagnose}),h('pre',{id:'aiDiagnosticResult',className:'ai-diagnostic-result',hidden:true,style:'white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:220px;overflow:auto'})),
      h('div',{id:'aiStatus',className:'ai-status section-gap',role:'status'}),h('div',{id:'aiResults',className:'ai-results'}));
    document.body.append(dialog);
    dialog.addEventListener('close',()=>current?.trigger?.focus());
  }
  async function open(options={}){
    ensureDialog();current=options;
    $('aiCountField').hidden=options.mode!=='planner';
    choices=await DB.get('aiTopicChoicesV1',{});
    const selected=new Set(options.pageIds||App.selected().map(p=>p.id));
    targets=await Promise.all(App.pages.map(async page=>{const data=await App.topics.load(page.id);const day=options.topicDay??choices[page.id]??new Date().getDay();const index=data.topics.findIndex(t=>Number(t.day)===Number(day));return {page,data,checked:selected.has(page.id),topicIndex:Math.max(0,index)};}));
    drawTargets();
    if(options.brief)$('aiBrief').value=options.brief;
    if(!session)session=await DB.get('aiDraftSessionV1',null);
    if(session&&!session.done){busy=true;} renderResults();renderProgress(session?.progress,session?.percent||0,!!(session&&!session.done));updateButtons();dialog.showModal();
    await checkConnection();
  }
  async function checkConnection(){
    const button=$('aiConnection').querySelector('button');button.disabled=true;connection(null);
    try{const s=await send('STATUS');connectorVersion=String(s.version||'');connection(true);
      if(s.job){session={...session,...s.job,posts:mergePosts(s.job.posts),done:!['opening','running'].includes(s.job.status)};busy=!session.done;await save();await persistReview();await acknowledgeReview(s.job.reviewKey);renderResults();}
      else if(busy){busy=false;if(session){session.done=true;session.error='Lượt trước đã ngắt kết nối. Các bản nháp đã nhận vẫn được giữ.';await save();}}
      renderProgress(session?.progress,session?.percent||0,busy);status(session?.error||session?.progress||'Nhập chủ đề bên trên rồi bấm “Tạo bằng ChatGPT”.',session?.error?'error':busy?'working':session?.posts?.length?'success':'info');
    }catch(e){busy=false;connection(false);status(e.message,'error');}finally{button.disabled=false;} updateButtons();
  }
  async function generate(){
    if(busy)return;if(!connectorReady){status('Cập nhật tiện ích lên 2.1.0 rồi tải lại trang trước khi tạo bài.','warning');return;}const brief=$('aiBrief').value.trim(),useTopics=$('aiTopicMode').checked;
    if(!useTopics&&!brief){status('Nhập chủ đề và thông tin thực tế cho bài viết.','warning');$('aiBrief').focus();return;}
    const selectedTargets=targets.filter(t=>t.checked);if(!selectedTargets.length)return status('Chọn ít nhất một Page trong danh sách bên trên.','warning');
    const count=current.mode==='planner'?Math.max(1,Math.min(3,Number($('aiCount').value)||1)):1;
    const total=selectedTargets.length*count;if(total>6)return status('Tối đa 6 bài mỗi lượt. Giảm số Page hoặc số bài mỗi Page.','warning');
    const items=[];
    for(const target of selectedTargets){const p=target.page,profile=target.data.profile,topic=useTopics?target.data.topics[target.topicIndex]:null;
      if(useTopics&&!topic?.title?.trim())return status('Page '+p.name+' chưa có tên chủ đề. Bấm Sửa chủ đề để bổ sung.','warning');
      for(let i=0;i<count;i++){
        const section=(label,value,max)=>value?label+': '+String(value).slice(0,max)+'\n':'';
        const request=section('Page nhận bài',p.name,300)+section('Ngành / sản phẩm',profile.niche,500)+section('Khách hàng',profile.audience,400)+section('Giọng văn Page',profile.voice,300)+(topic?section('Chủ đề',topic.title,300)+section('Phong cách',topic.style,250)+section('Định hướng',topic.direction,600)+section('Yêu cầu soạn bài',topic.postPrompt,900)+section('YÊU CẦU TẠO ẢNH cho đúng Page và chủ đề này',topic.imagePrompt||'Minh hoạ theo chủ đề và ngành hàng của Page.',700):'')+section('Thông tin bổ sung thực tế',brief,1000)+`Tạo bài ${i+1}/${count} riêng cho Page này. Không dùng ngành hàng hoặc thông tin của Page khác. Ảnh dọc 4:5 tối ưu điện thoại, có tiêu đề ngắn và dòng "Liên hệ: 0899779488", chữ dễ đọc, nằm cách mép ít nhất 8%; tổng chữ dưới 25% diện tích ảnh, phù hợp chính sách Facebook. Áp dụng bố cục và chữ này thay yêu cầu cũ về ảnh vuông hoặc không chữ trong chủ đề.`;
        items.push({key:uid('post'),pageId:p.id,pageName:p.name,brief:request,tone:$('aiTone').value==='Theo hồ sơ từng Page'?(profile.voice||topic?.style||'Thân thiện, tự nhiên').slice(0,100):$('aiTone').value,topicTitle:topic?.title||'Yêu cầu tự nhập'});
      }
    }
    // Gửi ngay từ thao tác bấm thật để tiện ích kiểm tra nguồn yêu cầu.
    busy=true;updateButtons();session={items,posts:[],progress:'Đang mở tab ChatGPT…',percent:5,hasImages:$('aiImages').checked,done:false,mode:current.mode};renderProgress(session.progress,5,true);status(session.progress,'working');
    try{const result=await send('GENERATE',{items,images:$('aiImages').checked});session={...session,id:result.id,items,posts:[],progress:'Đang chờ ChatGPT soạn bài…',percent:10,hasImages:$('aiImages').checked,done:false,mode:current.mode};await save();renderResults();renderProgress(session.progress,session.percent,true);status(session.progress,'working');}
    catch(e){busy=false;status(e.message,'error');}updateButtons();
  }
  function renderResults(){
    const root=$('aiResults');if(!root)return;
    const focused=document.activeElement?.closest?.('[data-ai-key]')?.dataset.aiKey;
    const selection=focused?{start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
    root.replaceChildren(...(current?.mode==='planner'&&session?.posts?.length?[h('button',{type:'button',className:'btn btn-primary','data-ai-apply':'1',disabled:false,textContent:'Thêm tất cả vào Lịch đăng (nháp)',onclick:async e=>{
      const applyButton=e.currentTarget;applyButton.disabled=true;
      try{const queue=await DB.get('fbScheduleQueueV1',[]);let added=0;
        const additions=[];
        for(const post of session.posts){const sourceId=session.id+'|'+post.key;if(queue.some(x=>x.aiSourceId===sourceId))continue;const p=App.pageById(post.pageId);if(!p)throw Error('Có Page chưa kết nối. Kiểm tra lại danh sách Page.');if(!post.text.trim())throw Error('Có bài chưa có nội dung.');additions.push({id:uid('fs'),pageKey:p.id,pageName:p.name,text:post.text,imageData:post.imageData,at:0,status:'draft',createdAt:Date.now(),source:'chatgpt',topicTitle:post.topicTitle||'',aiSourceId:sourceId});}
        await DB.set('fbScheduleQueueV1',[...queue,...additions]);added=additions.length;toast(added?'Đã thêm '+added+' bài nháp vào Lịch đăng.':'Các bài này đã có trong Lịch đăng.');App.tabs.planner?.refresh();
      }catch(err){status(err.message);}finally{applyButton.disabled=false;}
    }})]:[]),...(session?.posts||[]).map((post,index)=>{
      const text=h('textarea',{value:post.text,rows:6,'aria-label':'Nội dung bài '+(index+1),oninput:e=>{post.text=e.target.value;post._editedText=true;save();}});
      const preview=h('div',{className:'ai-image-preview'},...(post.imageData?[h('img',{src:post.imageData,alt:'Ảnh minh hoạ bài '+(index+1)})]:[]));
      const upload=h('input',{type:'file',accept:'image/*','aria-label':'Chọn ảnh cho bài '+(index+1),onchange:async e=>{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)return status('Chọn ảnh dưới 10 MB.');post.imageData=await fileToDataUrl(file);post.imageError='';post._editedImage=true;await save();renderResults();}});
      const button=h('button',{type:'button',className:'btn btn-primary','data-ai-apply':'1',disabled:false,textContent:current?.mode==='planner'?'Thêm vào Lịch đăng (nháp)':'Dùng cho bài đang soạn',onclick:async()=>{
        button.disabled=true;
        try{
          if(current.mode==='planner'){
            const p=App.pageById(post.pageId);if(!p)throw Error('Page này không còn kết nối. Đăng nhập hoặc chọn lại Page.');
            const queue=await DB.get('fbScheduleQueueV1',[]);const sourceId=session.id+'|'+post.key;
            if(queue.some(x=>x.aiSourceId===sourceId)){toast('Bài này đã có trong Lịch đăng.');return;}
            queue.push({id:uid('fs'),pageKey:p.id,pageName:p.name,text:post.text,imageData:post.imageData,at:0,status:'draft',createdAt:Date.now(),source:'chatgpt',topicTitle:post.topicTitle||'',aiSourceId:sourceId});await DB.set('fbScheduleQueueV1',queue);toast('Đã thêm bài nháp. Xếp giờ và duyệt trong Lịch đăng.');App.tabs.planner?.refresh();
          }else{await App.posting.applyAI(post);toast('Đã đưa nội dung và ảnh vào bài đang soạn.');dialog.close();}
        }catch(e){status(e.message);}finally{button.disabled=false;}
      }});
      return h('div',{className:'ai-result',dataset:{aiKey:post.key,pageId:post.pageId}},h('div',{className:'card-head'},h('h3',{className:'card-title',textContent:`Bài ${index+1} · ${post.pageName}`})),h('p',{className:'hint',textContent:'Page nhận: '+post.pageName+(post.topicTitle?' · Chủ đề: '+post.topicTitle:'')}),text,preview,
        post.imageError?h('p',{className:'status pending',textContent:'Ảnh chưa nhận được: '+post.imageError}):null,
        h('div',{className:'row'},h('label',{className:'field'},'Chọn hoặc thay ảnh',upload),button));
    }));
    if(focused){const card=[...root.querySelectorAll('[data-ai-key]')].find(el=>el.dataset.aiKey===focused);const field=card?.querySelector('textarea');if(field){field.focus();if(Number.isInteger(selection.start))field.setSelectionRange(selection.start,selection.end);}}
  }
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
  App.ai={open:openStudio,overview,syncCatalog:queueCatalog};
})();
