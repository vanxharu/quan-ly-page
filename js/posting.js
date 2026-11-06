/* Soạn tay trong Lịch đăng; giữ kho nháp cũ postDraftV1 và quản lý bài đã hẹn trên Facebook. */
(() => {
  const QUEUE='fbScheduleQueueV1';
  let draftImage='',draftPageId='',imageRead=Promise.resolve(''),draftWrites=Promise.resolve(),edited=false,publishing=false,queueing=false;
  const active=()=>publishing||queueing;
  const targets=()=>draftPageId?[App.pageById(draftPageId)].filter(Boolean):App.selected();
  function refresh(){
    if(!$('poComposer'))return;
    const page=App.pageById(draftPageId),list=targets();
    $('poTitle').textContent=draftPageId?(page?'Bài riêng cho '+page.name:'Page của bản nháp chưa kết nối'):`Dùng cho ${list.length} Page đang chọn`;
    $('poTargetHint').textContent=draftPageId?'Bài này giữ đúng Page đã gán.':'Chọn Page ở thanh trên cùng.';
    $('poReleasePage').hidden=!draftPageId;
    $('poPages').replaceChildren(...list.map(App.pageTag));
    $('poGo').textContent=publishing?'Đang gửi…':$('poAt').value?'Hẹn giờ trên Facebook':'Đăng ngay';
    $('poToQueue').textContent=queueing?'Đang lưu…':'Lưu vào danh sách duyệt';
    ['poGo','poToQueue','poText','poImage','poAt','poReleasePage'].forEach(id=>$(id).disabled=active());
    $('poPreview').querySelectorAll('button').forEach(button=>button.disabled=active());
    if($('plCompose'))$('plCompose').textContent=$('poText').value.trim()||draftImage?'Tiếp tục bản nháp':'Soạn tay';
  }
  function savePostDraft(){
    const text=$('poText').value,at=$('poAt').value,pageId=draftPageId,pendingImage=imageRead;
    $('poDraftState').textContent='Đang lưu nháp…';
    const write=draftWrites.catch(()=>{}).then(async()=>DB.set('postDraftV1',{text,at,pageId,image:await pendingImage}));
    draftWrites=write;
    write.then(()=>{$('poDraftState').textContent='Đã lưu nháp tự động.';},()=>{$('poDraftState').textContent='Chưa lưu được nháp. Giữ trang mở hoặc sao chép nội dung.';});
    refresh();return write;
  }
  function drawDraftImage(){
    $('poPreview').replaceChildren(...(draftImage?[h('img',{className:'thumb',src:draftImage,alt:'Ảnh bài viết'}),h('button',{type:'button',className:'btn btn-ghost btn-sm',textContent:'Bỏ ảnh',disabled:active(),onclick:()=>{
      edited=true;$('poImage').value='';draftImage='';imageRead=Promise.resolve('');drawDraftImage();savePostDraft();
    }})]:[]));
  }
  function open(){
    App.show('planner');if(!$('poComposer'))return;
    $('poComposer').hidden=false;refresh();$('poComposer').scrollIntoView?.({block:'start',behavior:'smooth'});$('poText').focus?.({preventScroll:true});
  }
  App.posting={open,refresh,
    async applyAI(post){
      if(!post.pageId||!App.pageById(post.pageId))throw Error('Không tìm thấy Page của bài AI. Kết nối lại Page trước khi dùng bài.');
      open();edited=true;draftPageId=String(post.pageId);$('poText').value=post.text||'';$('poImage').value='';draftImage=post.imageData||'';imageRead=Promise.resolve(draftImage);drawDraftImage();await savePostDraft();refresh();
    },
    mount(el){
      if($('poComposer'))return;
      el.append(h('section',{id:'poComposer',className:'post-manual planner-composer',hidden:true,'aria-label':'Soạn bài thủ công'},
        h('div',{className:'planner-composer-head'},h('h3',{className:'card-title',textContent:'Soạn bài'}),h('button',{type:'button',className:'btn btn-ghost btn-sm',textContent:'Đóng','aria-label':'Đóng trình soạn bài',onclick:()=>{$('poComposer').hidden=true;$('plCompose')?.focus?.();}})),
        h('label',{className:'field'},'Nội dung',h('textarea',{id:'poText',rows:6,placeholder:'Viết nội dung bài đăng…'})),
        h('p',{id:'poDraftState',className:'hint',role:'status',textContent:'Nội dung, ảnh và giờ hẹn được tự lưu nháp trên trình duyệt này.'}),
        h('div',{className:'form-grid'},
          h('label',{className:'field'},'Ảnh (tuỳ chọn)',h('input',{type:'file',id:'poImage',accept:'image/*'})),
          h('label',{className:'field'},'Hẹn giờ (tuỳ chọn)',h('input',{type:'datetime-local',id:'poAt'}))),
        h('div',{className:'row',id:'poPreview'}),
        h('div',{className:'planner-composer-target'},h('strong',{id:'poTitle'}),h('span',{id:'poTargetHint',className:'hint'}),h('div',{className:'tags',id:'poPages'}),
          h('button',{id:'poReleasePage',type:'button',className:'btn btn-ghost btn-sm',hidden:true,textContent:'Dùng các Page đang chọn',onclick:()=>{draftPageId='';edited=true;savePostDraft();}})),
        h('div',{className:'row'},h('button',{type:'button',className:'btn btn-primary',id:'poToQueue',textContent:'Lưu vào danh sách duyệt',onclick:toQueue}),h('button',{type:'button',className:'btn btn-ghost',id:'poGo',textContent:'Đăng ngay',onclick:go})),
        h('p',{className:'hint',textContent:'Để trống giờ hẹn để đăng ngay hoặc lưu nháp cho Lịch đăng tự xếp giờ.'}),h('div',{className:'log',id:'poLog'})));
      for(const id of ['poText','poAt'])$(id).oninput=()=>{edited=true;savePostDraft();};
      $('poImage').onchange=()=>{
        edited=true;const file=$('poImage').files[0];imageRead=file?fileToDataUrl(file):Promise.resolve('');
        imageRead.then(url=>{if($('poImage').files[0]===file){draftImage=url;drawDraftImage();refresh();}}).catch(()=>toast('Không đọc được ảnh. Chọn lại tệp giúp bạn nhé.'));
        savePostDraft();
      };
      DB.get('postDraftV1',{}).then(draft=>{
        if(edited)return;$('poText').value=draft.text||'';$('poAt').value=draft.at||'';draftPageId=String(draft.pageId||'');draftImage=draft.image||'';imageRead=Promise.resolve(draftImage);drawDraftImage();refresh();
        if(draft.text||draft.image)$('poDraftState').textContent='Đã khôi phục bản nháp trước. Bấm Tiếp tục bản nháp để mở.';
      }).catch(()=>{});refresh();
    }
  };
  const log=(cls,text)=>$('poLog').append(h('div',{className:'status '+cls,textContent:text}));
  async function read(){
    const text=$('poText').value.trim(),at=$('poAt').value,list=[...targets()],pendingImage=imageRead;
    if(at&&!Number.isFinite(new Date(at).getTime()))throw Error('Giờ hẹn không hợp lệ.');
    const file=await pendingImage;return {text,file,when:at?new Date(at).getTime():0,targets:list};
  }
  async function go(){
    if(active())return;publishing=true;refresh();$('poLog').replaceChildren();
    try{
      const {text,file,when,targets:list}=await read();
      if(!text&&!file)return log('err','Chưa có nội dung hoặc ảnh.');
      if(!list.length)return log('err','Chưa chọn Page hoặc Page của bản nháp chưa kết nối.');
      if(when&&(!Number.isFinite(when)||when<Date.now()+600e3))return log('err','Giờ hẹn phải sau hiện tại ít nhất 10 phút.');
      for(const page of list){try{const result=await App.publish(page,text,file,when?Math.floor(when/1000):0);log('ok',`✓ ${page.name}: ${when?'đã hẹn '+fmtTime(when):'đã đăng'} (${result.post_id||result.id})`);}catch(e){log('err',`✗ ${page.name}: ${e.message}`);}}
    }catch(e){log('err','Chưa gửi được bài: '+e.message);}finally{publishing=false;refresh();}
  }
  async function toQueue(){
    if(active())return;queueing=true;refresh();$('poLog').replaceChildren();
    try{
      const {text,file,when,targets:list}=await read();
      if(!text&&!file)return log('err','Chưa có nội dung hoặc ảnh.');
      if(!list.length)return log('err','Chưa chọn Page hoặc Page của bản nháp chưa kết nối.');
      const queue=await DB.get(QUEUE,[]);
      for(const page of list)queue.push({id:uid('fs'),pageKey:page.id,pageName:page.name,text,imageData:file,at:when||0,status:'draft',createdAt:Date.now(),source:'web'});
      await DB.set(QUEUE,queue);App.setSelected([...new Set([...App.selected().map(page=>page.id),...list.map(page=>page.id)])]);await App.planner.revealDrafts();
      log('ok',`Đã lưu ${list.length} bài nháp vào danh sách duyệt.`);toast('Đã lưu bản nháp. Xem và duyệt ngay trong Lịch đăng.');
    }catch(e){log('err','Chưa lưu được bản nháp: '+e.message);}finally{queueing=false;refresh();}
  }

  App.tab('scheduled', {
    mount(el) {
      el.append(h('div', { className: 'card' },
        h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Bài Facebook đang giữ để tự đăng (các Page đang chọn)' }),
          h('button', { className: 'btn btn-soft', onclick: () => this.refresh() }, icon('i-sync'), 'Tải lại')),
        h('div', { className: 'list', id: 'scList' })));
    },
    refresh() {
      return guard($('scList'), async () => {
        $('scList').replaceChildren(empty('Đang tải…'));
        const lists = await pool(App.selected(), 5, page => api(`/${page.id}/scheduled_posts`, { fields: 'id,message,scheduled_publish_time,full_picture,attachments{media,subattachments{media}}', limit: 100 }, 'GET', page.access_token)
          .catch(()=>api(`/${page.id}/scheduled_posts`,{fields:'id,message,scheduled_publish_time,full_picture',limit:100},'GET',page.access_token))
          .then(r => r.data.map(x => ({ ...x, page }))).catch(e => [{ error: `${page.name}: ${e.message}` }]));
        const all = lists.flat(), errors = all.filter(x => x.error);
        const res = { data: all.filter(x => !x.error) };
        $('scList').replaceChildren(...errors.map(e => h('div', { className: 'status err', textContent: e.error })), ...(res.data.length ? res.data.sort((a, b) => a.scheduled_publish_time - b.scheduled_publish_time).map(p => h('div', { className: 'item', style: 'cursor:default' },
          App.scheduledPostImage(p) ? h('img', { className: 'thumb', src: App.scheduledPostImage(p), alt: '' }) : null,
          h('div', { className: 'body' },
            h('div', { className: 'top' }, h('span', { className: 'status pending', textContent: '⏰ ' + fmtTime(p.scheduled_publish_time) }), App.pageTag(p.page)),
            h('div', { className: 'snippet', style: 'margin-top:6px', textContent: p.message || '(chỉ có ảnh)' })),
          h('div', { style: 'display:flex;flex-direction:column;gap:4px' },
            h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Đăng ngay', onclick: async e => {
              if (!confirm('Đăng bài này ngay bây giờ?')) return; e.target.disabled = true;
              await guard($('scList'), async () => { await api(`/${p.id}`, { is_published: true }, 'POST', p.page.access_token); toast('Đã đăng.'); await this.refresh(); });
            } }),
            h('button', { className: 'btn btn-danger btn-sm', textContent: 'Huỷ lịch', onclick: async e => {
              if (!confirm('Huỷ và xoá bài hẹn này trên Facebook?')) return; e.target.disabled = true;
              await guard($('scList'), async () => { await api(`/${p.id}`, {}, 'DELETE', p.page.access_token); await this.refresh(); });
            } })))) : [empty('Các Page đang chọn chưa có bài hẹn trên Facebook.')]));
      });
    }
  });
})();
