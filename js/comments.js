/* Bình luận trên bài của Page: trả lời (có chèn mẫu), thích, ẩn/hiện, xoá. Cần quyền pages_read_user_content + pages_manage_engagement. */
(() => {
  let postId = '', postPage = null;
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
        $('cmPosts').replaceChildren(empty('Đang tải bài…'));
        const errors = [];
        const lists = await pool(App.selected(), 5, page => api(`/${page.id}/posts`, { fields: 'id,message,created_time,full_picture,comments.limit(0).summary(true)', limit: 15 }, 'GET', page.access_token)
          .then(r => r.data.map(x => ({ ...x, page }))).catch(e => { errors.push(`${page.name}: ${e.message}`); return []; }));
        const res = { data: lists.flat().sort((a, b) => new Date(b.created_time) - new Date(a.created_time)).slice(0, 60) };
        $('cmPosts').replaceChildren(...(res.data.length ? res.data.map(p => h('div', { className: 'item' + (p.id === postId ? ' active' : ''), onclick: e => {
          [...$('cmPosts').children].forEach(x => x.classList.toggle('active', x === e.currentTarget)); postPage = p.page; loadComments(p.id);
        } },
          p.full_picture ? h('img', { className: 'thumb', src: p.full_picture, alt: '' }) : null,
          h('div', { className: 'body' },
            h('div', { className: 'top' }, App.selected().length > 1 ? App.pageTag(p.page) : null, h('span', { className: 'time', textContent: fmtTime(p.created_time) }),
              h('span', { style: 'margin-left:auto' }, h('span', { className: 'badge', textContent: p.comments?.summary?.total_count ?? 0 }), ' bình luận')),
            h('div', { className: 'snippet', style: 'margin-top:3px', textContent: p.message || '(không có chữ)' })))) : [empty('Chưa có bài.')]));
        // Page lỗi (thiếu quyền, Meta giới hạn…) phải báo rõ, không lặng lẽ hiện "Chưa có bài".
        errors.forEach(e => $('cmPosts').prepend(h('div', { className: 'status err', textContent: e })));
      });
    }
  });
  App.onPageChange.push(() => { postId = ''; $('cmList') && $('cmList').replaceChildren(empty('Chọn một bài bên trái để xem bình luận.')); });

  let loadSeq = 0;
  async function loadComments(id) {
    postId = id;
    const seq = ++loadSeq; // bấm bài khác khi bài trước chưa tải xong: kết quả cũ không được đè lên
    const page = postPage || App.page(), tpls = await App.templates.list(), tk = page.access_token;
    await guard($('cmList'), async () => {
      // Tối đa 300 bình luận (3 trang); trước đây chỉ 100 nên bài đông bình luận bị thiếu.
      const data = await apiPaged(`/${id}/comments`, { fields: 'id,from,message,created_time,is_hidden,can_hide,can_reply_privately,user_likes,attachment{media{image{src}}},comments{from,message}', order: 'reverse_chronological', limit: 100, filter: 'toplevel' }, tk, 3);
      if (seq !== loadSeq) return;
      const onlyOpen = $('cmUnanswered').checked;
      const list = data.filter(c => !onlyOpen || !(c.comments?.data || []).some(r => r.from?.id === page.id));
      $('cmList').replaceChildren(...(list.length ? list.map(c => {
        const input = h('input', { type: 'text', placeholder: 'Trả lời bình luận…', className: 'grow' });
        const send = h('button', { className: 'btn btn-primary btn-sm', textContent: 'Gửi', onclick: async () => {
          if (!input.value.trim()) return toast('Nhập nội dung trả lời.'); send.disabled = true;
          // Lỗi chỉ báo nhỏ, không xoá cả danh sách bình luận và chữ đang gõ.
          try { await api(`/${c.id}/comments`, { message: input.value.trim() }, 'POST', tk); toast('Đã trả lời bình luận.'); await loadComments(id); }
          catch (e) { toast(e.message, 6000); send.disabled = false; }
        } });
        // Nhắn riêng: gửi tin Messenger cho người bình luận (Meta cho 1 tin/bình luận, trong 7 ngày kể từ lúc bình luận).
        const dm = h('button', { className: 'btn btn-soft btn-sm', textContent: 'Nhắn riêng', title: 'Gửi nội dung ô trả lời vào Messenger của người bình luận (1 lần/bình luận, trong 7 ngày)',
          disabled: c.can_reply_privately === false, onclick: async () => {
            if (!input.value.trim()) return toast('Nhập nội dung tin nhắn riêng vào ô trả lời.');
            dm.disabled = true;
            try {
              await api(`/${page.id}/messages`, { recipient: { comment_id: c.id }, message: { text: input.value.trim() } }, 'POST', tk);
              toast(`Đã nhắn riêng cho ${c.from?.name || 'người bình luận'}.`); dm.textContent = 'Đã nhắn riêng'; input.value = '';
            } catch (e) {
              toast(Number(e.code) === 10900 || /already|đã/i.test(e.message) ? 'Bình luận này đã được nhắn riêng rồi (Meta chỉ cho 1 lần).' : e.message, 6000);
              dm.disabled = false;
            }
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
              act(c.user_likes ? '👍 Bỏ thích' : '👍 Thích', () => api(`/${c.id}/likes`, {}, c.user_likes ? 'DELETE' : 'POST', tk)),
              c.can_hide !== false ? act(c.is_hidden ? 'Hiện' : 'Ẩn', () => api(`/${c.id}`, { is_hidden: !c.is_hidden }, 'POST', tk)) : null,
              act('Xoá', async () => { if (!confirm('Xoá bình luận này?')) throw new Error('Đã huỷ.'); await api(`/${c.id}`, {}, 'DELETE', tk); }, 'btn-danger'))),
          h('div', { style: 'margin:6px 0 0 36px;white-space:pre-wrap;word-break:break-word', textContent: c.message || '' }),
          c.attachment?.media?.image?.src ? h('img', { src: c.attachment.media.image.src, alt: '', style: 'margin:6px 0 0 36px;max-width:160px;border-radius:8px' }) : null,
          ...(c.comments?.data || []).map(r => h('div', { className: 'reply-line', style: 'margin-left:36px', textContent: `↳ ${r.from?.name || ''}: ${r.message || ''}` })),
          h('div', { className: 'row', style: 'margin:8px 0 0 36px' }, input,
            h('select', { style: 'width:auto;max-width:140px', title: 'Chèn mẫu', onchange: e => {
              const t = tpls.find(x => x.id === e.target.value); if (t) input.value = App.resolveVars(t.content, { name: c.from?.name || '', pageName: page.name }); e.target.value = '';
            } }, h('option', { value: '', textContent: 'Mẫu…' }), ...tpls.map(t => h('option', { value: t.id, textContent: t.title }))), send, dm));
      }) : [empty(onlyOpen ? 'Mọi bình luận đã được Page trả lời.' : 'Bài này chưa có bình luận.')]));
    });
  }
})();
