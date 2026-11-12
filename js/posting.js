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
    ['poGo','poToQueue','poText','poImage','poAt','poReleasePage','poMsgBtn'].forEach(id=>$(id).disabled=active());
    $('poPreview').querySelectorAll('button').forEach(button=>button.disabled=active());
    if($('plCompose'))$('plCompose').textContent=$('poText').value.trim()||draftImage?'Tiếp tục bản nháp':'Soạn tay';
  }
  function savePostDraft(){
    const text=$('poText').value,at=$('poAt').value,pageId=draftPageId,pendingImage=imageRead,messageButton=$('poMsgBtn').checked;
    $('poDraftState').textContent='Đang lưu nháp…';
    const write=draftWrites.catch(()=>{}).then(async()=>DB.set('postDraftV1',{text,at,pageId,messageButton,image:await pendingImage}));
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
        h('label',{className:'row',style:'gap:8px;margin:6px 0'},h('input',{type:'checkbox',id:'poMsgBtn'}),h('span',{},'Thêm nút ',h('strong',{textContent:'Gửi tin nhắn'})),
          h('span',{className:'hint',textContent:'· Bài có ảnh: tạo qua tài khoản quảng cáo (không tốn tiền) để giữ ảnh + nút; bài hẹn giờ do máy chủ bot đăng.'})),
        h('div',{className:'row',id:'poPreview'}),
        h('div',{className:'planner-composer-target'},h('strong',{id:'poTitle'}),h('span',{id:'poTargetHint',className:'hint'}),h('div',{className:'tags',id:'poPages'}),
          h('button',{id:'poReleasePage',type:'button',className:'btn btn-ghost btn-sm',hidden:true,textContent:'Dùng các Page đang chọn',onclick:()=>{draftPageId='';edited=true;savePostDraft();}})),
        h('div',{className:'row'},h('button',{type:'button',className:'btn btn-primary',id:'poToQueue',textContent:'Lưu vào danh sách duyệt',onclick:toQueue}),h('button',{type:'button',className:'btn btn-ghost',id:'poGo',textContent:'Đăng ngay',onclick:go})),
        h('p',{className:'hint',textContent:'Để trống giờ hẹn để đăng ngay hoặc lưu nháp cho Lịch đăng tự xếp giờ.'}),h('div',{className:'log',id:'poLog'})));
      for(const id of ['poText','poAt'])$(id).oninput=()=>{edited=true;savePostDraft();};
      $('poMsgBtn').onchange=()=>{edited=true;savePostDraft();};
      $('poImage').onchange=()=>{
        edited=true;const file=$('poImage').files[0];imageRead=file?fileToDataUrl(file):Promise.resolve('');
        imageRead.then(url=>{if($('poImage').files[0]===file){draftImage=url;drawDraftImage();refresh();}}).catch(()=>toast('Không đọc được ảnh. Chọn lại tệp giúp bạn nhé.'));
        savePostDraft();
      };
      DB.get('postDraftV1',{}).then(draft=>{
        if(edited)return;$('poText').value=draft.text||'';$('poAt').value=draft.at||'';$('poMsgBtn').checked=!!draft.messageButton;draftPageId=String(draft.pageId||'');draftImage=draft.image||'';imageRead=Promise.resolve(draftImage);drawDraftImage();refresh();
        if(draft.text||draft.image)$('poDraftState').textContent='Đã khôi phục bản nháp trước. Bấm Tiếp tục bản nháp để mở.';
      }).catch(()=>{});refresh();
    }
  };
  const log=(cls,text)=>$('poLog').append(h('div',{className:'status '+cls,textContent:text}));
  async function read(){
    const text=$('poText').value.trim(),at=$('poAt').value,list=[...targets()],pendingImage=imageRead;
    if(at&&!Number.isFinite(new Date(at).getTime()))throw Error('Giờ hẹn không hợp lệ.');
    const file=await pendingImage;return {text,file,when:at?new Date(at).getTime():0,targets:list,messageButton:$('poMsgBtn').checked};
  }
  async function go(){
    if(active())return;publishing=true;refresh();$('poLog').replaceChildren();
    try{
      const {text,file,when,targets:list,messageButton}=await read();
      if(!text&&!file)return log('err','Chưa có nội dung hoặc ảnh.');
      if(!list.length)return log('err','Chưa chọn Page hoặc Page của bản nháp chưa kết nối.');
      if(when&&(!Number.isFinite(when)||when<Date.now()+600e3))return log('err','Giờ hẹn phải sau hiện tại ít nhất 10 phút.');
      for(const page of list){try{const result=await App.publish(page,text,file,when?Math.floor(when/1000):0,{messageButton});log('ok',`✓ ${page.name}: ${when?'đã hẹn '+fmtTime(when):'đã đăng'} (${result.post_id||result.id})`);
        $('poLog').append(h('div',{className:'row'},App.metaLink(when?App.metaScheduledUrl(page.id):App.metaPostUrl(result.post_id||result.id),when?'Xem lịch hẹn trên Meta ↗':'Xem bài ↗')));}catch(e){log('err',`✗ ${page.name}: ${e.message}`);}}
    }catch(e){log('err','Chưa gửi được bài: '+e.message);}finally{publishing=false;refresh();}
  }
  async function toQueue(){
    if(active())return;queueing=true;refresh();$('poLog').replaceChildren();
    try{
      const {text,file,when,targets:list,messageButton}=await read();
      if(!text&&!file)return log('err','Chưa có nội dung hoặc ảnh.');
      if(!list.length)return log('err','Chưa chọn Page hoặc Page của bản nháp chưa kết nối.');
      const queue=await DB.get(QUEUE,[]);
      for(const page of list)queue.push({id:uid('fs'),pageKey:page.id,pageName:page.name,text,imageData:file,at:when||0,status:'draft',createdAt:Date.now(),source:'web',messageButton});
      await DB.set(QUEUE,queue);App.setSelected([...new Set([...App.selected().map(page=>page.id),...list.map(page=>page.id)])]);await App.planner.revealDrafts();
      log('ok',`Đã lưu ${list.length} bài nháp vào danh sách duyệt.`);toast('Đã lưu bản nháp. Xem và duyệt ngay trong Lịch đăng.');
    }catch(e){log('err','Chưa lưu được bản nháp: '+e.message);}finally{queueing=false;refresh();}
  }

  // Bài hẹn đã huỷ trên Facebook: bỏ khỏi danh sách Lịch đăng để hai nơi khớp nhau.
  async function syncQueue(ids) {
    const gone = new Set(ids.map(String));
    const queue = await DB.get(QUEUE, []);
    if (queue.some(i => gone.has(String(i.fbPostId)))) { await DB.set(QUEUE, queue.filter(i => !gone.has(String(i.fbPostId)))); App.tabs.planner?.refresh?.(); }
  }
  // ── Đã hẹn trên FB: giao diện kiểu "Bài viết đã lên lịch" của Meta Business Suite ──
  // Bảng theo ngày, lọc Page / tìm nội dung, chọn nhiều để huỷ, đổi giờ, đăng ngay, mở trên Meta. Bài quá giờ mà Facebook
  // chưa đăng được tách riêng để dọn.
  const SC = { posts: [], errors: [], selected: new Set(), q: '', page: '', open: new Set(), editing: '', view: ['week', 'month'].includes(local.get('scView')) ? local.get('scView') : 'list', week: 0 };
  const WD = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const dayLabel = ms => { const d = new Date(ms), t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - t) / 864e5);
    return (diff === 0 ? 'Hôm nay · ' : diff === 1 ? 'Ngày mai · ' : '') + `${WD[d.getDay()]}, ${d.getDate()} tháng ${d.getMonth() + 1}${d.getFullYear() !== t.getFullYear() ? ', ' + d.getFullYear() : ''}`; };
  const hhmm = ms => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const until = ms => { const m = Math.round((ms - Date.now()) / 60e3); if (m < 0) return 'đã quá giờ'; if (m < 60) return `còn ${m} phút`; const hh = Math.round(m / 60); return hh < 48 ? `còn ${hh} giờ` : `còn ${Math.round(hh / 24)} ngày`; };
  const toInput = ms => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };
  App.tab('scheduled', {
    mount(el) {
      el.append(h('div', { className: 'card sc-card' },
        h('div', { className: 'sc-head' },
          h('div', {}, h('h3', { className: 'card-title', id: 'scTitle', textContent: 'Bài viết đã lên lịch' }), h('p', { className: 'hint', id: 'scSub', textContent: 'Các bài Facebook đang giữ để tự đăng trên các Page đang chọn.' })),
          h('div', { className: 'row', style: 'gap:8px' },
            h('button', { className: 'btn btn-danger', id: 'scCancelSel', hidden: true, onclick: () => this.cancelSelected() }, 'Huỷ đã chọn'),
            h('button', { className: 'btn btn-ghost', id: 'scCancelAll', onclick: () => this.cancelAll() }, 'Huỷ tất cả'),
            h('button', { className: 'btn btn-soft', onclick: () => this.refresh() }, icon('i-sync'), 'Tải lại'))),
        h('div', { className: 'sc-toolbar' },
          h('input', { type: 'search', id: 'scSearch', placeholder: 'Tìm theo nội dung bài viết…', 'aria-label': 'Tìm bài', oninput: e => { SC.q = e.target.value; this.draw(); } }),
          h('select', { id: 'scPage', 'aria-label': 'Lọc theo Page', onchange: e => { SC.page = e.target.value; this.draw(); } }),
          h('div', { className: 'sc-seg', role: 'group', 'aria-label': 'Kiểu xem' }, ...[['list', 'Danh sách'], ['week', 'Tuần'], ['month', 'Tháng']].map(([v, t]) =>
            h('button', { type: 'button', dataset: { view: v }, 'aria-pressed': String(SC.view === v), textContent: t, onclick: () => { SC.view = v; local.set('scView', v); this.draw(); } }))),
          h('span', { className: 'grow' }), h('span', { className: 'hint', id: 'scCount' })),
        h('div', { className: 'sc-table', id: 'scList', role: 'table', 'aria-label': 'Bài viết đã lên lịch' }),
        h('div', { id: 'scMonth', hidden: true })));

    },
    async cancelPosts(posts, label) {
      if (!posts.length) return toast('Không có bài hẹn nào để huỷ.');
      if (!confirm(`Huỷ và xoá ${posts.length} ${label} trên Facebook? Bài sẽ không được đăng và không khôi phục được.`)) return;
      let ok = 0; const failed = [];
      await pool(posts, 3, async p => { try { await api(`/${p.id}`, {}, 'DELETE', p.page.access_token); ok++; } catch (e) { failed.push(`${p.page.name}: ${e.message}`); } });
      await syncQueue(posts.map(p => p.id)); SC.selected.clear();
      toast(`Đã huỷ ${ok}/${posts.length} bài hẹn.${failed.length ? ' Lỗi: ' + failed.slice(0, 3).join('; ') : ''}`, 6000);
      await this.refresh();
    },
    cancelAll() { return this.cancelPosts(this.visible(), 'bài đang hiện'); },
    cancelSelected() { return this.cancelPosts(SC.posts.filter(p => SC.selected.has(p.id)), 'bài đã chọn'); },
    visible() {
      const q = norm(SC.q);
      return SC.posts.filter(p => (!SC.page || p.page.id === SC.page) && (!q || norm(p.message || '').includes(q)));
    },
    async reschedule(p, value) {
      const at = new Date(value).getTime();
      if (!Number.isFinite(at) || at < Date.now() + 600e3) return toast('Giờ mới phải sau hiện tại ít nhất 10 phút.');
      await guard($('scList'), async () => {
        await api(`/${p.id}`, { scheduled_publish_time: Math.floor(at / 1000) }, 'POST', p.page.access_token);
        const queue = await DB.get(QUEUE, []);
        if (queue.some(i => String(i.fbPostId) === String(p.id))) { await DB.set(QUEUE, queue.map(i => String(i.fbPostId) === String(p.id) ? { ...i, at } : i)); App.tabs.planner?.refresh?.(); }
        SC.editing = ''; toast('Đã đổi giờ đăng: ' + fmtTime(at)); await this.refresh();
      });
    },
    row(p) {
      const ms = p.scheduled_publish_time * 1000, img = App.scheduledPostImage(p), late = ms < Date.now(), opened = SC.open.has(p.id), editing = SC.editing === p.id;
      const check = h('input', { type: 'checkbox', checked: SC.selected.has(p.id), 'aria-label': 'Chọn bài', onchange: e => { e.target.checked ? SC.selected.add(p.id) : SC.selected.delete(p.id); this.syncSelection(); } });
      return h('div', { className: 'sc-row' + (SC.selected.has(p.id) ? ' is-selected' : '') + (late ? ' is-late' : ''), role: 'row', dataset: { post: p.id } },
        h('div', { className: 'sc-cell sc-check' }, check),
        h('div', { className: 'sc-cell sc-post' },
          img ? h('img', { className: 'sc-thumb', src: img, alt: '', loading: 'lazy' }) : h('div', { className: 'sc-thumb sc-thumb-empty', textContent: 'Aa' }),
          h('div', { className: 'sc-post-copy' },
            h('div', { className: 'sc-text' + (opened ? ' is-open' : ''), title: opened ? '' : 'Bấm để xem đầy đủ', textContent: p.message || '(Bài chỉ có ảnh)', onclick: () => { opened ? SC.open.delete(p.id) : SC.open.add(p.id); this.draw(); } }),
            h('div', { className: 'sc-sub' }, img ? 'Ảnh · ' : 'Chữ · ', 'ID ' + p.id.split('_').pop()))),
        h('div', { className: 'sc-cell sc-page' }, App.avatar(p.page.name, App.pageAvatarUrl(p.page), 32), h('span', { textContent: p.page.name, title: p.page.name })),
        h('div', { className: 'sc-cell sc-time' },
          editing ? h('form', { className: 'sc-resched', onsubmit: e => { e.preventDefault(); this.reschedule(p, e.target.elements.at.value); } },
              h('input', { type: 'datetime-local', name: 'at', value: toInput(Math.max(ms, Date.now() + 15 * 60e3)), required: true }),
              h('button', { className: 'btn btn-primary btn-sm', textContent: 'Lưu' }), h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Huỷ', onclick: () => { SC.editing = ''; this.draw(); } }))
            : [h('strong', { textContent: hhmm(ms) }), h('span', { className: 'sc-sub' + (late ? ' sc-late' : ''), textContent: late ? 'Quá giờ · Facebook chưa đăng' : until(ms) })]),
        h('div', { className: 'sc-cell sc-actions' },
          App.metaLink(App.metaScheduledUrl(p.page.id), 'Xem ↗'),
          editing ? null : h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Đổi giờ', onclick: () => { SC.editing = p.id; this.draw(); } }),
          h('button', { className: 'btn btn-soft btn-sm', textContent: 'Đăng ngay', onclick: async e => {
            if (!confirm('Đăng bài này ngay bây giờ?')) return; e.target.disabled = true;
            await guard($('scList'), async () => { await api(`/${p.id}`, { is_published: true }, 'POST', p.page.access_token); await syncQueue([p.id]); toast('Đã đăng.'); await this.refresh(); });
          } }),
          h('button', { className: 'btn btn-danger btn-sm', textContent: 'Huỷ', onclick: () => this.cancelPosts([p], 'bài hẹn này') })));
    },
    syncSelection() {
      for (const id of [...SC.selected]) if (!SC.posts.some(p => p.id === id)) SC.selected.delete(id);
      if (!$('scCancelSel')) return;
      $('scCancelSel').hidden = !SC.selected.size; $('scCancelSel').textContent = `Huỷ đã chọn (${SC.selected.size})`;
      $('scList').querySelectorAll('.sc-row').forEach(r => r.classList.toggle('is-selected', !!r.querySelector('.sc-check input:checked')));
      const all = $('scList').querySelector('.sc-headrow input'); if (all) { const v = this.visible(); all.checked = !!v.length && v.every(p => SC.selected.has(p.id)); }
    },
    // Lịch tuần kiểu Business Suite: 7 cột ngày, mỗi bài là thẻ có ảnh bài, avatar Page, giờ đăng và 2 dòng nội dung.
    drawWeek(list) {
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + SC.week * 7);
      const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 864e5));
      const end = days[6].getTime() + 864e5;
      const inWeek = list.filter(p => p.scheduled_publish_time * 1000 >= start.getTime() && p.scheduled_publish_time * 1000 < end);
      const card = p => { const ms = p.scheduled_publish_time * 1000, img = App.scheduledPostImage(p);
        return h('button', { type: 'button', className: 'sc-wcard', title: `${p.page.name}\n${hhmm(ms)} · ${p.message || ''}`.slice(0, 300), onclick: () => { SC.view = 'list'; local.set('scView', 'list'); SC.open.add(p.id); this.draw(); $('scList').querySelector(`[data-post="${p.id}"]`)?.scrollIntoView({ block: 'center' }); } },
          h('div', { className: 'sc-wmedia' }, img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('div', { className: 'sc-thumb-empty', textContent: 'Aa' }),
            h('span', { className: 'sc-wavatar' }, App.avatar(p.page.name, App.pageAvatarUrl(p.page), 22))),
          h('div', { className: 'sc-wbody' }, h('strong', { textContent: hhmm(ms) }), h('span', { className: 'sc-wpage', textContent: p.page.name }), h('span', { className: 'sc-wtext', textContent: p.message || '(Bài chỉ có ảnh)' }))); };
      const label = d => `${d.getDate()}/${d.getMonth() + 1}`;
      return [h('div', { className: 'sc-weeknav' },
          h('button', { className: 'btn btn-ghost btn-sm', textContent: '‹ Tuần trước', disabled: SC.week <= 0, onclick: () => { SC.week--; this.draw(); } }),
          h('strong', { textContent: `${label(days[0])} – ${label(days[6])} · ${inWeek.length} bài` }),
          h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Tuần sau ›', onclick: () => { SC.week++; this.draw(); } })),
        h('div', { className: 'sc-week' }, ...days.map(d => { const items = inWeek.filter(p => new Date(p.scheduled_publish_time * 1000).toDateString() === d.toDateString()).sort((a, b) => a.scheduled_publish_time - b.scheduled_publish_time);
          const today = d.toDateString() === new Date().toDateString();
          return h('div', { className: 'sc-wday' + (today ? ' is-today' : '') }, h('div', { className: 'sc-wdayhead' }, h('span', { textContent: WD[d.getDay()] }), h('strong', { textContent: label(d) })),
            ...(items.length ? items.map(card) : [h('span', { className: 'sc-wempty', textContent: '—' })])); }))];
    },
    draw() {
      if (!$('scList')) return;
      $('scList').closest('.sc-card')?.querySelectorAll('.sc-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === SC.view)));
      // Tháng: lịch tháng gộp bài đã đăng, bài hẹn trên FB và hàng chờ (kéo bài hàng chờ sang ngày khác để đổi ngày).
      const monthView = SC.view === 'month';
      $('scList').hidden = monthView; if ($('scMonth')) $('scMonth').hidden = !monthView;
      $('scSearch').hidden = monthView; $('scPage').hidden = monthView;
      if (monthView) { if ($('scMonth') && !$('scMonth').childElementCount) App.monthCalendar?.mount($('scMonth')); App.monthCalendar?.refresh(); return this.syncSelection(); }
      const pages = [...new Map(SC.posts.map(p => [p.page.id, p.page])).values()];
      $('scPage').replaceChildren(h('option', { value: '', textContent: `Tất cả Page (${SC.posts.length})` }), ...pages.map(pg => h('option', { value: pg.id, selected: pg.id === SC.page, textContent: `${pg.name} (${SC.posts.filter(p => p.page.id === pg.id).length})` })));
      const list = this.visible().sort((a, b) => a.scheduled_publish_time - b.scheduled_publish_time);
      const late = list.filter(p => p.scheduled_publish_time * 1000 < Date.now()), upcoming = list.filter(p => !late.includes(p));
      $('scTitle').textContent = `Bài viết đã lên lịch (${upcoming.length})`;
      $('scCount').textContent = list.length !== SC.posts.length ? `Đang hiện ${list.length}/${SC.posts.length} bài` : '';
      const groups = new Map();
      for (const p of upcoming) { const k = dayLabel(p.scheduled_publish_time * 1000); (groups.get(k) || groups.set(k, []).get(k)).push(p); }
      const head = h('div', { className: 'sc-row sc-headrow', role: 'row' },
        h('div', { className: 'sc-cell sc-check' }, h('input', { type: 'checkbox', 'aria-label': 'Chọn tất cả bài đang hiện', onchange: e => { list.forEach(p => e.target.checked ? SC.selected.add(p.id) : SC.selected.delete(p.id)); this.draw(); } })),
        ...['Bài viết', 'Trang', 'Thời gian đăng', ''].map(t => h('div', { className: 'sc-cell', role: 'columnheader', textContent: t })));
      const section = (label, items, cls = '') => [h('div', { className: 'sc-day ' + cls }, h('span', { textContent: label }), h('span', { className: 'sc-day-count', textContent: `${items.length} bài` })), ...items.map(p => this.row(p))];
      if (SC.view === 'week') { $('scList').replaceChildren(...SC.errors.map(e => h('div', { className: 'status err', textContent: e })), ...this.drawWeek(upcoming)); return this.syncSelection(); }
      $('scList').replaceChildren(
        ...SC.errors.map(e => h('div', { className: 'status err', textContent: e })),
        ...(list.length ? [head, ...[...groups].flatMap(([k, items]) => section(k, items)),
          ...(late.length ? section('Quá giờ nhưng Facebook chưa đăng · nên Huỷ hoặc Đổi giờ', late, 'sc-day-late') : [])]
          : [h('div', { className: 'sc-empty' }, h('div', { className: 'sc-empty-icon', textContent: '🗓' }), h('strong', { textContent: SC.posts.length ? 'Không có bài khớp bộ lọc' : 'Chưa có bài nào được lên lịch' }),
              h('span', { className: 'hint', textContent: SC.posts.length ? 'Đổi Page hoặc xoá từ khoá tìm kiếm.' : 'Soạn bài hoặc dùng Lịch đăng để hẹn giờ; bài sẽ hiện ở đây.' }))]));
      this.syncSelection();
    },
    refresh() {
      return guard($('scList'), async () => {
        $('scList').replaceChildren(h('div', { className: 'sc-empty' }, h('span', { className: 'hint', textContent: 'Đang tải bài đã lên lịch…' })));
        const lists = await pool(App.selected(), 5, page => api(`/${page.id}/scheduled_posts`, { fields: 'id,message,scheduled_publish_time,full_picture,attachments{media,subattachments{media}}', limit: 100 }, 'GET', page.access_token)
          .catch(()=>api(`/${page.id}/scheduled_posts`,{fields:'id,message,scheduled_publish_time,full_picture',limit:100},'GET',page.access_token))
          .then(r => r.data.map(x => ({ ...x, page }))).catch(e => [{ error: `${page.name}: ${e.message}` }]));
        const all = lists.flat();
        SC.errors = all.filter(x => x.error).map(x => x.error); SC.posts = all.filter(x => !x.error);
        if (SC.page && !SC.posts.some(p => p.page.id === SC.page)) SC.page = '';
        this.posts = SC.posts; if (SC.view === 'month') App.monthCalendar?.reload(); this.draw();
      });
    }
  });
})();
