(() => {
  const $=id=>document.getElementById(id);let state={},catalogStamp=0,choices={},loadTimer;
  const node=(tag,props={},...children)=>{const el=document.createElement(tag);Object.assign(el,props);el.append(...children.filter(x=>x!=null));return el;};
  const call=async(type,extra={})=>{const result=await chrome.runtime.sendMessage({type,...extra});if(!result?.ok)throw Error(result?.error||'Tiện ích chưa sẵn sàng.');return result;};
  function notice(text,error=false){$('notice').hidden=!text;$('notice').textContent=text||'';$('notice').className=error?'error':'';}
  const busy=()=>['opening','running'].includes(state.panelJob?.status)||state.externalRunning;
  const ready=()=>state.panelJob?.posts?.filter(p=>!p.transferredAt&&(state.panelJob.completedKeys?.includes(p.key)||!['opening','running'].includes(state.panelJob.status)&&p.text?.trim()))||[];
  function scope(){const n=(state.pageCatalog?.pages||[]).filter(p=>choices[p.id]?.checked).length,count=Math.max(1,Math.min(3,Math.trunc(Number($('count').value))||1));$('scope').textContent=`${n} Page × ${count} bài = ${n*count} bài. Tối đa 6 bài/lượt.`;}
  async function remember(){await chrome.storage.local.set({studioChoices:choices});scope();}
  function drawPages(){
    const pages=state.pageCatalog?.pages||[];
    $('catalogHint').textContent=pages.length?`${pages.length} Page đã đồng bộ từ web. Chọn chủ đề cho từng Page.`:'Mở Meta Assistant và đăng nhập Page một lần để đồng bộ danh sách cùng chủ đề.';
    $('pages').replaceChildren(...pages.map(page=>{
      const choice=choices[page.id]||(choices[page.id]={checked:page.selected,index:Math.max(0,page.topics.findIndex(t=>Number(t.day)===new Date().getDay()))});
      const box=node('div',{className:'page'+(choice.checked?' selected':'')});
      const check=node('input',{type:'checkbox',checked:choice.checked,disabled:!!busy(),onchange:e=>{choice.checked=e.target.checked;box.className='page'+(choice.checked?' selected':'');remember().catch(e=>notice(e.message,true));}});
      const select=node('select',{disabled:!!busy(),onchange:e=>{choice.index=Number(e.target.value);remember().catch(e=>notice(e.message,true));}},...page.topics.map((t,i)=>node('option',{value:String(i),textContent:`${t.dayLabel||''} · ${t.title||'Chủ đề'}`,selected:i===choice.index})));
      select.setAttribute('aria-label','Chủ đề của '+page.name);box.append(node('label',{className:'check'},check,node('span',{textContent:page.name})),node('label',{className:'field'},'Chủ đề',select));return box;
    }));scope();
  }
  async function transfer(keys){try{notice('Đang mở web để chuyển bài…');await call('PANEL_TRANSFER',{keys});notice('Đã gửi yêu cầu chuyển. Web sẽ xác nhận khi lưu xong.');await load();}catch(e){notice(e.message,true);}}
  function drawResults(){
    if(document.activeElement?.matches('textarea[data-key]'))return;
    const job=state.panelJob,posts=job?.posts||[];$('draftCount').textContent=posts.length?`${job.completedKeys?.length||0}/${job.input.items.length} bài xong`:'';$('empty').hidden=!!posts.length;
    $('results').replaceChildren(...posts.map((post,index)=>{
      const complete=job.completedKeys?.includes(post.key),canTransfer=complete||!['opening','running'].includes(job.status)&&!!post.text?.trim(),card=node('article',{className:'draft'});
      const text=node('textarea',{value:post.text,rows:6,onchange:async e=>{try{await call('PANEL_EDIT',{key:post.key,text:e.target.value});}catch(err){notice(err.message,true);}},onblur:()=>setTimeout(()=>load().catch(()=>{}),100)});text.dataset.key=post.key;text.setAttribute('aria-label','Nội dung bài '+(index+1));
      card.append(node('h3',{textContent:post.pageName}),node('p',{className:'hint',textContent:post.topicTitle||''}),node('div',{className:'pill',textContent:post.transferredAt?'Đã chuyển sang web':complete?'Đã lưu trong tiện ích':'Đang hoàn thiện bài & ảnh'}),text);
      if(post.imageData)card.append(node('img',{src:post.imageData,alt:'Ảnh bài '+(index+1)}));
      if(post.imageError)card.append(node('p',{className:'hint',textContent:post.imageError}));
      card.append(node('div',{className:'actions'},node('button',{className:'quiet',disabled:!canTransfer,textContent:post.transferredAt?'Mở lại trên web ↗':'Đưa bài này sang web ↗',onclick:()=>transfer([post.key])})));return card;
    }));
  }
  async function load(){
    state=await call('PANEL_STATUS');if(catalogStamp!==state.pageCatalog?.updatedAt){catalogStamp=state.pageCatalog?.updatedAt;drawPages();}
    const job=state.panelJob,active=busy();$('generate').disabled=!!active||!!ready().length;$('cancel').hidden=!active;
    document.querySelectorAll('#pages input,#pages select').forEach(el=>el.disabled=!!active);
    $('progressBox').hidden=!job&&!state.externalRunning;$('progressTitle').textContent=active?'Đang tạo nội dung':'Đã lưu bản nháp';
    const total=job?.input.items.length||1,complete=job?.completedKeys?.length||0,percent=Math.round(100*complete/total);
    $('progress').value=percent;$('loading').hidden=!active;$('progressCount').textContent=`${complete}/${job?.input.items.length||0}`;
    $('progressText').textContent=state.externalRunning?'Có lượt đang chạy từ web. Bấm Dừng để bắt đầu tại tiện ích.':job?.error||job?.progress||'';
    $('transfer').disabled=!ready().length||!!state.pendingTransfer;$('transfer').textContent=state.pendingTransfer?'Đang chờ web xác nhận…':`Đưa ${ready().length||''} bản nháp sang web ↗`;
    $('transferHint').textContent=ready().length?'Bản nháp được giữ ở đây đến khi web xác nhận đã nhận.':'Chuyển vào Lịch đăng · Chờ duyệt';drawResults();
  }
  $('generate').onclick=async()=>{try{
    const pages=(state.pageCatalog?.pages||[]).filter(p=>choices[p.id]?.checked),count=Math.max(1,Math.min(3,Math.trunc(Number($('count').value))||1));if(!pages.length)throw Error('Chọn ít nhất một Page.');if(pages.length*count>6)throw Error('Tối đa 6 bài/lượt. Giảm số Page hoặc số bài.');
    const items=[];for(const page of pages){const topic=page.topics[choices[page.id].index];if(!topic?.title)throw Error('Page '+page.name+' chưa có chủ đề. Chỉnh trong tab Chủ đề trên web.');for(let i=0;i<count;i++){const profile=page.profile;const brief=`Page: ${page.name}\nNgành / sản phẩm: ${profile.niche}\nKhách hàng: ${profile.audience}\nChủ đề: ${topic.title}\nPhong cách: ${topic.style}\nĐịnh hướng: ${topic.direction}\nYêu cầu bài: ${topic.postPrompt}\nYêu cầu ảnh: ${topic.imagePrompt}\nThông tin bổ sung: ${$('brief').value.trim()}\nBài ${i+1}/${count} cho đúng Page này. Ảnh dọc 4:5, có tiêu đề và Liên hệ: 0899779488, chữ dưới 25%; bài có 2–3 hashtag. Chỉ dùng thông tin thực tế.`;items.push({key:'post-'+crypto.randomUUID(),pageId:page.id,pageName:page.name,topicTitle:topic.title,brief,tone:profile.voice||topic.style||'Thân thiện, tự nhiên'});}}
    $('generate').disabled=true;await call('PANEL_GENERATE',{payload:{items,images:$('images').checked}});notice('Đang tạo từng bài. Bạn có thể theo dõi bên cạnh tab ChatGPT.');await load();
  }catch(e){notice(e.message,true);$('generate').disabled=!!busy()||!!ready().length;}};
  $('cancel').onclick=async()=>{try{await call('PANEL_CANCEL');await load();}catch(e){notice(e.message,true);}};
  $('transfer').onclick=()=>transfer(ready().map(p=>p.key));
  $('count').oninput=scope;$('refresh').onclick=()=>load().catch(e=>notice(e.message,true));
  $('openWeb').onclick=()=>call('PANEL_OPEN_WEB').catch(e=>notice(e.message,true));
  chrome.storage.onChanged.addListener((_changes,area)=>{if(area==='local'){clearTimeout(loadTimer);loadTimer=setTimeout(()=>load().catch(e=>notice(e.message,true)),100);}});
  (async()=>{choices=(await chrome.storage.local.get('studioChoices')).studioChoices||{};await load();})().catch(e=>notice(e.message,true));
})();