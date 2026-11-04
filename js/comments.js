/* Bình luận trên bài của Page: trả lời (có chèn mẫu), thích, ẩn/hiện, xoá. Cần quyền pages_read_user_content + pages_manage_engagement. */
(() => {
  let postId = '';
  App.tab('comments', {
    mount(el) {
      el.append(h('div', { className: 'split' },
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Bài gần đây' }), h('button', { className: 'btn btn-soft', onclick: () => this.refresh() }, icon('i-sync'), 'Tải lại')),
          h('div', { className: 'list', id: 'cmPosts' })),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Bình luận' }),
            h('label', { className: 'row', style: 'gap:6px;font-size:12px' }, h('input', { type: 'checkbox', id: 'cmUnanswered', onchange: () => postId && loadComments(postId) }), 'Chỉ bình luận Page chưa trả lời')),
          h('div', { id: 'cmList' }, empty('Chọn một bài bên trái để xem bình luận.')))));
    },
    refresh() {
      return guard($('cmPosts'), async () => {
        const res = await api(`/${App.page().id}/posts`, { fields: 'id,message,created_time,full_picture,comments.limit(0).summary(true)', limit: 25 });
        $('cmPosts').replaceChildren(...(res.data.length ? res.data.map(p => h('div', { className: 'item' + (p.id === postId ? ' active' : ''), onclick: e => {
          [...$('cmPosts').children].forEach(x => x.classList.toggle('active', x === e.currentTarget)); loadComments(p.id);
        } },
          p.full_picture ? h('img', { className: 'thumb', src: p.full_picture, alt: '' }) : null,
          h('div', { className: 'body' },
            h('div', { className: 'top' }, h('span', { className: 'time', textContent: fmtTime(p.created_time) }),
              h('span', { style: 'margin-left:auto' }, h('span', { className: 'badge', textContent: p.comments?.summary?.total_count ?? 0 }), ' bình luận')),
            h('div', { className: 'snippet', style: 'margin-top:3px', textContent: p.message || '(không có chữ)' })))) : [empty('Chưa có bài.')]));
      });
    }
  });
  App.onPageChange.push(() => { postId = ''; $('cmList') && $('cmList').replaceChildren(empty('Chọn một bài bên trái để xem bình luận.')); });

  async function loadComments(id) {
    postId = id;
    const page = App.page(), tpls = await App.templates.list();
    await guard($('cmList'), async () => {
      const res = await api(`/${id}/comments`, { fields: 'id,from,message,created_time,is_hidden,can_hide,user_likes,attachment{media{image{src}}},comments{from,message}', order: 'reverse_chronological', limit: 100, filter: 'toplevel' });
      const onlyOpen = $('cmUnanswered').checked;
      const list = res.data.filter(c => !onlyOpen || !(c.comments?.data || []).some(r => r.from?.id === page.id));
      $('cmList').replaceChildren(...(list.length ? list.map(c => {
        const input = h('input', { type: 'text', placeholder: 'Trả lời bình luận…', className: 'grow' });
        const send = h('button', { className: 'btn btn-primary btn-sm', textContent: 'Gửi', onclick: async () => {
          if (!input.value.trim()) return; send.disabled = true;
          await guard($('cmList'), async () => { await api(`/${c.id}/comments`, { message: input.value.trim() }, 'POST'); await loadComments(id); });
        } });
        input.onkeydown = e => { if (e.key === 'Enter') send.click(); };
        const act = (text, fn, cls = 'btn-ghost') => h('button', { className: `btn btn-sm ${cls}`, textContent: text, onclick: async e => {
          e.target.disabled = true; try { await fn(); await loadComments(id); } catch (err) { toast(err.message); e.target.disabled = false; }
        } });
        return h('div', { className: 'comment', style: c.is_hidden ? 'opacity:.55' : '' },
          h('div', { className: 'row', style: 'gap:8px' },
            h('div', { className: 'avatar', style: 'width:28px;height:28px;font-size:11px', textContent: initials(c.from?.name) }),
            h('strong', { textContent: c.from?.name || 'Người dùng' }), h('span', { className: 'hint', textContent: fmtTime(c.created_time) }),
            c.is_hidden ? h('span', { className: 'tag', textContent: 'Đã ẩn' }) : null,
            h('span', { style: 'margin-left:auto;display:flex;gap:4px' },
              act(c.user_likes ? '👍 Bỏ thích' : '👍 Thích', () => api(`/${c.id}/likes`, {}, c.user_likes ? 'DELETE' : 'POST')),
              c.can_hide !== false ? act(c.is_hidden ? 'Hiện' : 'Ẩn', () => api(`/${c.id}`, { is_hidden: !c.is_hidden }, 'POST')) : null,
              act('Xoá', async () => { if (!confirm('Xoá bình luận này?')) throw new Error('Đã huỷ.'); await api(`/${c.id}`, {}, 'DELETE'); }, 'btn-danger'))),
          h('div', { style: 'margin:6px 0 0 36px;white-space:pre-wrap;word-break:break-word', textContent: c.message || '' }),
          c.attachment?.media?.image?.src ? h('img', { src: c.attachment.media.image.src, alt: '', style: 'margin:6px 0 0 36px;max-width:160px;border-radius:8px' }) : null,
          ...(c.comments?.data || []).map(r => h('div', { className: 'reply-line', style: 'margin-left:36px', textContent: `↳ ${r.from?.name || ''}: ${r.message || ''}` })),
          h('div', { className: 'row', style: 'margin:8px 0 0 36px' }, input,
            h('select', { style: 'width:auto;max-width:140px', title: 'Chèn mẫu', onchange: e => {
              const t = tpls.find(x => x.id === e.target.value); if (t) input.value = App.resolveVars(t.content, { name: c.from?.name || '', pageName: page.name }); e.target.value = '';
            } }, h('option', { value: '', textContent: 'Mẫu…' }), ...tpls.map(t => h('option', { value: t.id, textContent: t.title }))), send));
      }) : [empty(onlyOpen ? 'Mọi bình luận đã được Page trả lời.' : 'Bài này chưa có bình luận.')]));
    });
  }
})();
