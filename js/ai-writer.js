/* Soạn bài/ảnh qua tab ChatGPT và tiện ích kết nối; kết quả chỉ thành bản nháp. */
(() => {
  const pending=new Map();let dialog=null,current=null,busy=false,session=null;
  const send=(type,payload)=>new Promise((resolve,reject)=>{
    const id=uid('ai');const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Chưa kết nối tiện ích. Cài tiện ích trong Chrome rồi tải lại trang.'));},4000);
    pending.set(id,{resolve,reject,timeout});window.postMessage({source:'META_ASSISTANT_AI',type,id,payload},location.origin);
  });
  const safePosts=posts=>(Array.isArray(posts)?posts:[]).slice(0,6).filter(p=>p&&typeof p.key==='string').map(p=>({
    key:p.key.slice(0,80),pageId:String(p.pageId||'').slice(0,40),pageName:String(p.pageName||'').slice(0,300),
    text:String(p.text||'').slice(0,18000),imagePrompt:String(p.imagePrompt||'').slice(0,5000),
    imageData:typeof p.imageData==='string'&&p.imageData.length<=600000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.imageData)?p.imageData:'',
    imageError:String(p.imageError||'').slice(0,500)
  }));
  function mergePosts(incoming){return safePosts(incoming).map(post=>{const previous=session?.posts?.find(x=>x.key===post.key);return previous?{...post,...(previous._editedText?{text:previous.text,_editedText:true}:{}),...(previous._editedImage?{imageData:previous.imageData,imageError:'',_editedImage:true}:{})}:post;});}
  const save=async()=>{if(session)await DB.set('aiDraftSessionV1',session);};
  window.addEventListener('message',async e=>{
    const m=e.data;if(e.source!==window||e.origin!==location.origin||m?.source!=='META_AI_CONNECTOR')return;
    if(m.type==='REPLY'&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timeout);pending.delete(m.id);m.ok?p.resolve(m):p.reject(Error(m.error||'Tiện ích chưa sẵn sàng.'));return;}
    if(!session||m.id!==session.id)return;
    if(m.type==='PROGRESS'){session.progress=String(m.text||'').slice(0,500);status(session.progress);return;}
    if(['PARTIAL','RESULT'].includes(m.type)){
      session.posts=mergePosts(m.posts);session.error=String(m.error||'').slice(0,1000);
      if(m.type==='RESULT'){busy=false;session.done=true;session.progress=m.error?'Đã dừng. Các kết quả đã nhận vẫn được giữ.':'Đã nhận bài và ảnh. Xem lại trước khi sử dụng.';}
      await save();renderResults();status(session.progress);updateButtons();
      if(!dialog?.open)toast(m.type==='RESULT'?'ChatGPT đã trả kết quả. Mở AI soạn bài để xem.':'Đã nhận nội dung từ ChatGPT.',5000);
    }
  });
  const status=text=>{const el=$('aiStatus');if(el)el.textContent=text||'';};
  function updateButtons(){if($('aiGenerate'))$('aiGenerate').disabled=busy;if($('aiCancel'))$('aiCancel').hidden=!busy;dialog?.querySelectorAll('[data-ai-apply]').forEach(b=>b.disabled=busy);}
  function ensureDialog(){
    if(dialog)return;
    dialog=h('dialog',{className:'ai-dialog','aria-labelledby':'aiDialogTitle'});
    dialog.append(h('div',{className:'ai-dialog-head'},h('div',{},h('h2',{id:'aiDialogTitle',textContent:'AI soạn bài & tạo ảnh'}),h('p',{className:'muted',textContent:'Dùng tab ChatGPT đang đăng nhập, nhận kết quả về bản nháp.'})),h('button',{type:'button',className:'icon-btn','aria-label':'Đóng trợ lý',textContent:'×',onclick:()=>dialog.close()})),
      h('details',{className:'ai-install'},h('summary',{textContent:'Kết nối ChatGPT lần đầu'}),h('p',{textContent:'Tải và giải nén tiện ích. Trong Chrome, mở chrome://extensions, bật Chế độ dành cho nhà phát triển, chọn Tải tiện ích đã giải nén rồi chọn thư mục có manifest.json. Sau đó tải lại trang này.'}),
        h('a',{className:'btn btn-ghost',href:'chatgpt-connector.zip',download:'meta-assistant-chatgpt-connector.zip',textContent:'Tải tiện ích kết nối'}),h('p',{className:'hint',textContent:'Tiện ích cần truy cập ChatGPT, ảnh ChatGPT và trang Meta Assistant này. Không dùng quyền gỡ lỗi. Giữ tab ChatGPT mở khi tạo bài.'})),
      h('div',{className:'form-grid'},
        h('label',{className:'field wide'},'Chủ đề / yêu cầu',h('textarea',{id:'aiBrief',placeholder:'Ví dụ: giới thiệu bộ sưu tập mới, đối tượng khách, lợi ích, giá và ưu đãi có thật…',rows:4})),
        h('label',{className:'field'},'Giọng văn',h('select',{id:'aiTone'},...['Thân thiện, tự nhiên','Chuyên nghiệp','Ngắn gọn, rõ ràng','Gần gũi, kể chuyện'].map(t=>h('option',{value:t,textContent:t})))),
        h('label',{className:'field',id:'aiCountField'},'Số bài cho mỗi Page',h('input',{id:'aiCount',type:'number',min:1,max:3,value:1}))),
      h('div',{className:'row section-gap'},h('label',{className:'row',style:'gap:7px'},h('input',{id:'aiImages',type:'checkbox',checked:true}),'Tạo thêm ảnh minh hoạ'),h('span',{className:'hint',textContent:'Yêu cầu ảnh không chèn chữ, luôn dưới 25% diện tích chữ.'})),
      h('div',{id:'aiScope',className:'hint section-gap'}),
      h('div',{className:'row section-gap'},h('button',{id:'aiGenerate',type:'button',className:'btn btn-primary','data-ai-generate':'1',textContent:'Tạo bằng ChatGPT',onclick:generate}),h('button',{id:'aiCancel',type:'button',hidden:true,className:'btn btn-ghost',textContent:'Dừng nhận kết quả',onclick:async()=>{try{await send('CANCEL');}catch(e){status(e.message);}}})),
      h('div',{id:'aiStatus',className:'status pending section-gap',role:'status',textContent:'Đang kiểm tra kết nối…'}),h('div',{id:'aiResults',className:'ai-results'}));
    document.body.append(dialog);
    dialog.addEventListener('close',()=>current?.trigger?.focus());
  }
  async function open(options={}){
    ensureDialog();current=options;
    $('aiCountField').hidden=options.mode!=='planner';
    $('aiScope').textContent=options.mode==='planner'?`Tạo nháp cho ${App.selected().length} Page đang chọn. Mỗi lượt tối đa 6 bài.`:`Soạn một bài để dùng cho các Page đang chọn.`;
    if(options.brief)$('aiBrief').value=options.brief;
    if(!session)session=await DB.get('aiDraftSessionV1',null);
    if(session&&!session.done){busy=true;} renderResults();updateButtons();dialog.showModal();
    try{const s=await send('STATUS');
      if(s.job){session={...session,...s.job,posts:mergePosts(s.job.posts),done:!['opening','running'].includes(s.job.status)};busy=!session.done;await save();renderResults();}
      else if(busy){busy=false;if(session){session.done=true;session.error='Lượt trước đã ngắt kết nối. Các bản nháp đã nhận vẫn được giữ.';await save();}}
      status(session?.error||session?.progress||'Đã kết nối tiện ích. Sẵn sàng dùng tab ChatGPT.');
    }catch(e){busy=false;status(e.message);} updateButtons();
  }
  async function generate(){
    if(busy)return;const brief=$('aiBrief').value.trim();if(!brief)return status('Nhập chủ đề và thông tin thực tế cho bài viết.');
    const pages=App.selected();if(!pages.length)return status('Chọn Page ở thanh trên trước khi tạo bài.');
    const count=current.mode==='planner'?Math.max(1,Math.min(3,Number($('aiCount').value)||1)):1;
    const total=current.mode==='planner'?pages.length*count:1;if(total>6)return status('Tối đa 6 bài mỗi lượt. Giảm số Page hoặc số bài mỗi Page.');
    const items=[];
    if(current.mode==='planner')for(const p of pages)for(let i=0;i<count;i++)items.push({key:uid('post'),pageId:p.id,pageName:p.name,brief:brief+`\nĐây là bài ${i+1}/${count} cho Page này, cần khác các bài còn lại.`,tone:$('aiTone').value});
    else items.push({key:uid('post'),pageId:pages[0].id,pageName:pages.map(p=>p.name).join(', ').slice(0,300),brief,tone:$('aiTone').value});
    // Gửi ngay từ thao tác bấm thật để tiện ích kiểm tra nguồn yêu cầu.
    busy=true;updateButtons();status('Đang mở tab ChatGPT…');
    try{const result=await send('GENERATE',{items,images:$('aiImages').checked});session={id:result.id,posts:[],progress:'Đang làm việc trong tab ChatGPT. Nếu cần, hãy đăng nhập tại tab đó.',done:false,mode:current.mode};await save();renderResults();status(session.progress);}
    catch(e){busy=false;status(e.message);}updateButtons();
  }
  function renderResults(){
    const root=$('aiResults');if(!root)return;
    const focused=document.activeElement?.closest?.('[data-ai-key]')?.dataset.aiKey;
    const selection=focused?{start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
    root.replaceChildren(...(current?.mode==='planner'&&session?.posts?.length?[h('button',{type:'button',className:'btn btn-primary','data-ai-apply':'1',disabled:busy,textContent:'Thêm tất cả vào Lịch đăng (nháp)',onclick:async e=>{
      const applyButton=e.currentTarget;applyButton.disabled=true;
      try{const queue=await DB.get('fbScheduleQueueV1',[]);let added=0;
        const additions=[];
        for(const post of session.posts){const sourceId=session.id+'|'+post.key;if(queue.some(x=>x.aiSourceId===sourceId))continue;const p=App.pageById(post.pageId);if(!p)throw Error('Có Page chưa kết nối. Kiểm tra lại danh sách Page.');if(!post.text.trim())throw Error('Có bài chưa có nội dung.');additions.push({id:uid('fs'),pageKey:p.id,pageName:p.name,text:post.text,imageData:post.imageData,at:0,status:'draft',createdAt:Date.now(),source:'chatgpt',aiSourceId:sourceId});}
        await DB.set('fbScheduleQueueV1',[...queue,...additions]);added=additions.length;toast(added?'Đã thêm '+added+' bài nháp vào Lịch đăng.':'Các bài này đã có trong Lịch đăng.');App.tabs.planner?.refresh();
      }catch(err){status(err.message);}finally{applyButton.disabled=false;}
    }})]:[]),...(session?.posts||[]).map((post,index)=>{
      const text=h('textarea',{value:post.text,rows:6,'aria-label':'Nội dung bài '+(index+1),oninput:e=>{post.text=e.target.value;post._editedText=true;save();}});
      const preview=h('div',{className:'ai-image-preview'},...(post.imageData?[h('img',{src:post.imageData,alt:'Ảnh minh hoạ bài '+(index+1)})]:[]));
      const upload=h('input',{type:'file',accept:'image/*','aria-label':'Chọn ảnh cho bài '+(index+1),onchange:async e=>{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)return status('Chọn ảnh dưới 10 MB.');post.imageData=await fileToDataUrl(file);post.imageError='';post._editedImage=true;await save();renderResults();}});
      const button=h('button',{type:'button',className:'btn btn-primary','data-ai-apply':'1',disabled:busy,textContent:current?.mode==='planner'?'Thêm vào Lịch đăng (nháp)':'Dùng cho bài đang soạn',onclick:async()=>{
        button.disabled=true;
        try{
          if(current.mode==='planner'){
            const p=App.pageById(post.pageId);if(!p)throw Error('Page này không còn kết nối. Đăng nhập hoặc chọn lại Page.');
            const queue=await DB.get('fbScheduleQueueV1',[]);const sourceId=session.id+'|'+post.key;
            if(queue.some(x=>x.aiSourceId===sourceId)){toast('Bài này đã có trong Lịch đăng.');return;}
            queue.push({id:uid('fs'),pageKey:p.id,pageName:p.name,text:post.text,imageData:post.imageData,at:0,status:'draft',createdAt:Date.now(),source:'chatgpt',aiSourceId:sourceId});await DB.set('fbScheduleQueueV1',queue);toast('Đã thêm bài nháp. Xếp giờ và duyệt trong Lịch đăng.');App.tabs.planner?.refresh();
          }else{await App.posting.applyAI(post);toast('Đã đưa nội dung và ảnh vào bài đang soạn.');dialog.close();}
        }catch(e){status(e.message);}finally{button.disabled=false;}
      }});
      return h('div',{className:'ai-result',dataset:{aiKey:post.key}},h('div',{className:'card-head'},h('h3',{className:'card-title',textContent:`Bài ${index+1} · ${post.pageName}`})),text,preview,
        post.imageError?h('p',{className:'status pending',textContent:'Ảnh chưa nhận được: '+post.imageError}):null,
        h('div',{className:'row'},h('label',{className:'field'},'Chọn hoặc thay ảnh',upload),button));
    }));
    if(focused){const card=[...root.querySelectorAll('[data-ai-key]')].find(el=>el.dataset.aiKey===focused);const field=card?.querySelector('textarea');if(field){field.focus();if(Number.isInteger(selection.start))field.setSelectionRange(selection.start,selection.end);}}
  }
  App.ai={open};
})();
