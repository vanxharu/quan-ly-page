/* Đăng Fanpage: đăng ngay / hẹn giờ lên nhiều Page, hoặc đưa vào Lịch đăng (fbScheduleQueueV1) làm nháp để xếp giờ và duyệt.
 * Đã hẹn trên FB: bài Facebook đang giữ để tự đăng (scheduled_posts) của Page đang chọn. */
(() => {
  const QUEUE = 'fbScheduleQueueV1';
  App.tab('post', {
    mount(el) {
      el.append(
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Soạn bài' })),
          h('textarea', { id: 'poText', placeholder: 'Nội dung bài viết…' }),
          h('div', { className: 'row', style: 'margin-top:12px' },
            h('label', { className: 'field' }, 'Ảnh (tuỳ chọn)', h('input', { type: 'file', id: 'poImage', accept: 'image/*' })),
            h('label', { className: 'field' }, 'Hẹn giờ (bỏ trống = đăng ngay / để Lịch đăng xếp giờ)', h('input', { type: 'datetime-local', id: 'poAt' })))),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Đăng lên Page' }),
            h('button', { className: 'btn btn-ghost', textContent: 'Chọn tất cả', onclick: () => {
              const boxes = [...$('poPages').querySelectorAll('input')], all = boxes.every(b => b.checked); boxes.forEach(b => { b.checked = !all; });
            } })),
          h('div', { id: 'poPages' }),
          h('div', { className: 'row', style: 'margin-top:14px' },
            h('button', { className: 'btn btn-primary', id: 'poGo', onclick: () => go() }, icon('i-send'), 'Đăng / Hẹn giờ ngay'),
            h('button', { className: 'btn btn-soft', onclick: () => toQueue() }, icon('i-cal'), 'Thêm vào Lịch đăng (nháp)'),
            h('span', { className: 'hint', textContent: 'Giờ hẹn phải sau hiện tại ít nhất 10 phút.' })),
          h('div', { className: 'log', id: 'poLog' })));
      $('poPages').replaceWith(Object.assign(App.pageChecks([App.page()?.id]), { id: 'poPages' }));
    }
  });
  const log = (cls, t) => $('poLog').append(h('div', { className: 'status ' + cls, textContent: t }));
  const read = async () => {
    const text = $('poText').value.trim(), file = $('poImage').files[0], at = $('poAt').value;
    return { text, file, when: at ? new Date(at).getTime() : 0, targets: App.checkedPages($('poPages')) };
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
    const imageData = file ? await fileToDataUrl(file) : '';
    const queue = await DB.get(QUEUE, []);
    for (const p of targets) queue.push({ id: uid('fs'), pageKey: p.id, pageName: p.name, text, imageData, at: when || 0, status: 'draft', createdAt: Date.now(), source: 'web' });
    await DB.set(QUEUE, queue);
    log('ok', `Đã thêm ${targets.length} bài nháp vào Lịch đăng.`);
    toast('Đã thêm vào Lịch đăng. Mở Đăng bài › Lịch đăng để xếp giờ và duyệt.');
  }

  App.tab('scheduled', {
    mount(el) {
      el.append(h('div', { className: 'card' },
        h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Bài Facebook đang giữ để tự đăng (Page đang chọn)' }),
          h('button', { className: 'btn btn-soft', onclick: () => this.refresh() }, icon('i-sync'), 'Tải lại')),
        h('div', { className: 'list', id: 'scList' })));
    },
    refresh() {
      return guard($('scList'), async () => {
        const res = await api(`/${App.page().id}/scheduled_posts`, { fields: 'id,message,scheduled_publish_time,full_picture', limit: 100 });
        $('scList').replaceChildren(...(res.data.length ? res.data.sort((a, b) => a.scheduled_publish_time - b.scheduled_publish_time).map(p => h('div', { className: 'item', style: 'cursor:default' },
          p.full_picture ? h('img', { className: 'thumb', src: p.full_picture, alt: '' }) : null,
          h('div', { className: 'body' },
            h('div', { className: 'top' }, h('span', { className: 'status pending', textContent: '⏰ ' + fmtTime(p.scheduled_publish_time) })),
            h('div', { className: 'snippet', style: 'margin-top:6px', textContent: p.message || '(chỉ có ảnh)' })),
          h('div', { style: 'display:flex;flex-direction:column;gap:4px' },
            h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Đăng ngay', onclick: async e => {
              if (!confirm('Đăng bài này ngay bây giờ?')) return; e.target.disabled = true;
              await guard($('scList'), async () => { await api(`/${p.id}`, { is_published: true }, 'POST'); toast('Đã đăng.'); await this.refresh(); });
            } }),
            h('button', { className: 'btn btn-danger btn-sm', textContent: 'Huỷ lịch', onclick: async e => {
              if (!confirm('Huỷ và xoá bài hẹn này trên Facebook?')) return; e.target.disabled = true;
              await guard($('scList'), async () => { await api(`/${p.id}`, {}, 'DELETE'); await this.refresh(); });
            } })))) : [empty('Page này chưa có bài hẹn trên Facebook.')]));
      });
    }
  });
})();
