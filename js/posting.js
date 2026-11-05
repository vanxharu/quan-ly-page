/* Đăng Fanpage: đăng ngay / hẹn giờ lên nhiều Page, hoặc đưa vào Lịch đăng (fbScheduleQueueV1) làm nháp để xếp giờ và duyệt.
 * Đã hẹn trên FB: bài Facebook đang giữ để tự đăng (scheduled_posts) của Page đang chọn. */
(() => {
  const QUEUE = 'fbScheduleQueueV1';
  let draftImage = '', draftPageId = '', imageRead = Promise.resolve(''), draftWrites = Promise.resolve(), edited = false;
  function savePostDraft() {
    const text = $('poText').value, at = $('poAt').value, pendingImage = imageRead, pageId = draftPageId;
    $('poDraftState').textContent = 'Đang lưu nháp…';
    draftWrites = draftWrites.catch(() => {}).then(async () => DB.set('postDraftV1', { text, at, pageId, image: await pendingImage }));
    draftWrites.then(() => { $('poDraftState').textContent = 'Đã lưu nháp tự động.'; }, () => { $('poDraftState').textContent = 'Chưa lưu được nháp. Hãy giữ trang mở hoặc sao chép nội dung.'; });
  }
  function drawDraftImage() {
    $('poPreview').replaceChildren(...(draftImage ? [h('img', { className: 'thumb', src: draftImage, alt: 'Ảnh bài viết' }),
      h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Bỏ ảnh', onclick: () => {
        edited = true; $('poImage').value = ''; draftImage = ''; imageRead = Promise.resolve(''); drawDraftImage(); savePostDraft();
      } })] : []));
  }
  App.posting = { async applyAI(post) {
    if(!post.pageId||!App.pageById(post.pageId))throw Error('Không tìm thấy Page của bài AI. Kết nối lại Page trước khi dùng bài.');
    App.show('post'); edited = true; if($('poManual'))$('poManual').open=true;
    draftPageId=String(post.pageId);
    $('poText').value = post.text || ''; $('poImage').value = '';
    draftImage = post.imageData || ''; imageRead = Promise.resolve(draftImage);
    drawDraftImage(); savePostDraft(); App.tabs.post.refresh();
  } };
  App.tab('post', {
    mount(el) {
      el.append(
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Soạn bài' }),
            h('button', { type: 'button', className: 'btn btn-soft', textContent: '✦ AI soạn bài & tạo ảnh', onclick: e => App.ai.open({ mode: 'post', pageIds: draftPageId?[draftPageId]:undefined, trigger: e.currentTarget }) })),
          h('textarea', { id: 'poText', placeholder: 'Nội dung bài viết…' }),
          h('div', { id: 'poDraftState', className: 'hint', style: 'margin-top:8px', role: 'status', textContent: 'Nội dung, ảnh và giờ hẹn được lưu nháp trên trình duyệt này.' }),
          h('div', { className: 'row', style: 'margin-top:12px' },
            h('label', { className: 'field' }, 'Ảnh (tuỳ chọn)', h('input', { type: 'file', id: 'poImage', accept: 'image/*' })),
            h('label', { className: 'field' }, 'Hẹn giờ (bỏ trống = đăng ngay / để Lịch đăng xếp giờ)', h('input', { type: 'datetime-local', id: 'poAt' }))),
          h('div', { className: 'row', id: 'poPreview', style: 'margin-top:12px' })),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', id: 'poTitle' }), h('span', { id:'poTargetHint', className: 'hint' })),
          h('div', { className: 'tags', id: 'poPages' }),
          h('button',{id:'poReleasePage',type:'button',className:'btn btn-ghost btn-sm',hidden:true,textContent:'Đổi sang các Page đang chọn',onclick:()=>{if(!confirm('Dùng bài này cho các Page đang chọn ở thanh trên?'))return;draftPageId='';edited=true;savePostDraft();App.tabs.post.refresh();}}),
          h('div', { className: 'row', style: 'margin-top:14px' },
            h('button', { className: 'btn btn-primary', id: 'poGo', onclick: () => go() }, icon('i-send'), 'Đăng / Hẹn giờ ngay'),
            h('button', { className: 'btn btn-soft', onclick: () => toQueue() }, icon('i-cal'), 'Thêm vào Lịch đăng (nháp)'),
            h('span', { className: 'hint', textContent: 'Giờ hẹn phải sau hiện tại ít nhất 10 phút.' })),
          h('div', { className: 'log', id: 'poLog' })));
      const manual=h('details',{id:'poManual',className:'post-manual'},
        h('summary',{},h('span',{},'Tự viết hoặc chỉnh sửa bài'),h('span',{className:'hint',textContent:'Tuỳ chọn'})));
      const body=h('div',{className:'post-manual-body'},...el.children);manual.append(body);
      el.append(
        h('div',{className:'card ai-first-hero'},
          h('div',{},h('span',{className:'ai-first-eyebrow',textContent:'SÁNG TẠO CÙNG AI'}),h('h3',{textContent:'Tạo bài và ảnh cho từng Page'}),
            h('p',{textContent:'Chọn chủ đề đã lưu. ChatGPT soạn bài có hashtag, tạo ảnh dọc và lưu từng bài ngay khi xong.'}),
            h('div',{className:'ai-first-steps'},h('span',{},'1 · Chọn Page & chủ đề'),h('span',{},'2 · AI tạo bài & ảnh'),h('span',{},'3 · Xem lại & đăng'))),
          h('button',{type:'button',className:'btn btn-primary',textContent:'✦ Tạo bài bằng AI',onclick:e=>App.ai.open({mode:'post',trigger:e.currentTarget})})),
        h('div',{id:'poAIDrafts'}),manual);
      App.ai.overview($('poAIDrafts'),'post');
      for (const id of ['poText', 'poAt']) $(id).oninput = () => { edited = true; savePostDraft(); };
      $('poImage').onchange = () => {
        edited = true; const file = $('poImage').files[0];
        imageRead = file ? fileToDataUrl(file) : Promise.resolve('');
        imageRead.then(url => { if ($('poImage').files[0] === file) { draftImage = url; drawDraftImage(); } }).catch(() => toast('Không đọc được ảnh. Chọn lại tệp giúp bạn nhé.'));
        savePostDraft();
      };
      DB.get('postDraftV1', {}).then(draft => {
        if (edited) return;
        $('poText').value = draft.text || ''; $('poAt').value = draft.at || '';
        draftPageId = String(draft.pageId||''); draftImage = draft.image || ''; imageRead = Promise.resolve(draftImage); drawDraftImage(); App.tabs.post.refresh();
        if (draft.text || draft.image) {$('poDraftState').textContent = 'Đã khôi phục bản nháp trước.';$('poManual').open=true;}
      }).catch(() => {});
    },
    refresh() {
      const page=App.pageById(draftPageId), list=draftPageId?(page?[page]:[]):App.selected();
      $('poTitle').textContent = draftPageId ? (page?'Bài riêng cho '+page.name:'Page của bài nháp chưa kết nối') : `Đăng lên ${list.length} Page đang chọn`;
      $('poTargetHint').textContent=draftPageId?'Giữ đúng Page của bài AI, kể cả khi đổi bộ lọc Page ở trên.':'Đổi Page ở ô chọn Page trên cùng.';
      $('poReleasePage').hidden=!draftPageId;
      $('poPages').replaceChildren(...list.map(App.pageTag));
    }
  });
  const log = (cls, t) => $('poLog').append(h('div', { className: 'status ' + cls, textContent: t }));
  const read = async () => {
    const text = $('poText').value.trim(), file = $('poImage').files[0] || draftImage, at = $('poAt').value;
    const page=App.pageById(draftPageId);
    return { text, file, when: at ? new Date(at).getTime() : 0, targets: draftPageId?(page?[page]:[]):App.selected() };
  };
  async function go() {
    const { text, file, when, targets } = await read();
    $('poLog').replaceChildren();
    if (!text && !file) return log('err', 'Chưa có nội dung hoặc ảnh.');
    if (!targets.length) return log('err', 'Chưa chọn Page.');
    if (when && when < Date.now() + 600e3) return log('err', 'Giờ hẹn phải sau hiện tại ít nhất 10 phút (quy định của Facebook).');
    $('poGo').disabled = true;
    for (const p of targets) {
      try {
        const res = await App.publish(p, text, file, when ? Math.floor(when / 1000) : 0);
        log('ok', `✓ ${p.name}: ${when ? 'đã hẹn ' + fmtTime(when) : 'đã đăng'} (${res.post_id || res.id})`);
      } catch (e) { log('err', `✗ ${p.name}: ${e.message}`); }
    }
    $('poGo').disabled = false;
  }
  async function toQueue() {
    const { text, file, when, targets } = await read();
    $('poLog').replaceChildren();
    if (!text && !file) return log('err', 'Chưa có nội dung hoặc ảnh.');
    if (!targets.length) return log('err', 'Chưa chọn Page.');
    const imageData = typeof file === 'string' ? file : file ? await fileToDataUrl(file) : '';
    const queue = await DB.get(QUEUE, []);
    for (const p of targets) queue.push({ id: uid('fs'), pageKey: p.id, pageName: p.name, text, imageData, at: when || 0, status: 'draft', createdAt: Date.now(), source: 'web' });
    await DB.set(QUEUE, queue);
    log('ok', `Đã thêm ${targets.length} bài nháp vào Lịch đăng.`);
    toast('Đã thêm vào Lịch đăng. Mở Đăng bài › Lịch đăng để xếp giờ và duyệt.');
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
        const lists = await pool(App.selected(), 5, page => api(`/${page.id}/scheduled_posts`, { fields: 'id,message,scheduled_publish_time,full_picture', limit: 100 }, 'GET', page.access_token)
          .then(r => r.data.map(x => ({ ...x, page }))).catch(e => [{ error: `${page.name}: ${e.message}` }]));
        const all = lists.flat(), errors = all.filter(x => x.error);
        const res = { data: all.filter(x => !x.error) };
        $('scList').replaceChildren(...errors.map(e => h('div', { className: 'status err', textContent: e.error })), ...(res.data.length ? res.data.sort((a, b) => a.scheduled_publish_time - b.scheduled_publish_time).map(p => h('div', { className: 'item', style: 'cursor:default' },
          p.full_picture ? h('img', { className: 'thumb', src: p.full_picture, alt: '' }) : null,
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
