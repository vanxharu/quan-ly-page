/* Chủ đề (giống topic-library.js + hồ sơ Page của tiện ích): kế hoạch nội dung 7 ngày và hồ sơ ngành/khách/giọng văn từng Page.
 * Trang web không dùng ChatGPT nên đây là gợi ý để tự viết; "Viết bài theo chủ đề" mở Đăng Fanpage kèm dàn ý.
 * Lưu: marketingTopicLibraryV1, fanpageProfilesV1 (cùng khoá với tiện ích). */
(() => {
  const LIB = 'marketingTopicLibraryV1', PROFILES = 'fanpageProfilesV1';
  const FIELDS = [['title', 'Chủ đề'], ['time', 'Giờ gợi ý'], ['style', 'Phong cách'], ['direction', 'Định hướng'], ['postPrompt', 'Gợi ý nội dung bài']];
  const topics = async () => { const v = await DB.get(LIB); return Array.isArray(v) && v.length ? v : Pure.DEFAULT_TOPICS.map(t => ({ ...t })); };
  App.tab('topics', {
    mount(el) {
      el.append(h('div', { className: 'card', id: 'tpProfile' }), h('div', { className: 'card-head section-gap' },
        h('h3', { className: 'card-title', textContent: 'Kế hoạch chủ đề 7 ngày' }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Khôi phục mặc định', onclick: async () => { if (confirm('Đưa 7 chủ đề về mặc định?')) { await DB.del(LIB); this.refresh(); } } })),
        h('div', { className: 'tpl-cards', id: 'tpList' }));
    },
    async refresh() {
      const list = await topics(), today = new Date().getDay();
      $('tpList').replaceChildren(...list.map((t, idx) => h('form', { className: 'tpl-card', style: Number(t.day) === today ? 'border-color:var(--primary)' : '', onsubmit: async e => {
        e.preventDefault(); const f = new FormData(e.target); const all = await topics();
        all[idx] = { ...all[idx], ...Object.fromEntries(FIELDS.map(([k]) => [k, String(f.get(k) || '')])) }; await DB.set(LIB, all); toast('Đã lưu chủ đề.');
      } },
        h('div', { className: 'row' }, h('strong', { className: 'grow', textContent: t.dayLabel }), Number(t.day) === today ? h('span', { className: 'tag tone-green', textContent: 'Hôm nay' }) : null),
        ...FIELDS.map(([k, label]) => h('label', { className: 'field' }, label, k === 'postPrompt' || k === 'direction' ? h('textarea', { name: k, value: t[k] || '', style: 'min-height:70px' }) : h('input', { type: 'text', name: k, value: t[k] || '' }))),
        h('div', { className: 'actions' }, h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Lưu' }),
          h('button', { type: 'button', className: 'btn btn-soft btn-sm', textContent: 'Viết bài theo chủ đề', onclick: () => {
            App.show('post'); $('poText').value = `${t.title}\n\n${t.direction || ''}`.trim(); $('poText').focus();
          } })))));
      // Hồ sơ Page đang chọn
      const page = App.page(), all = await DB.get(PROFILES, {});
      const key = Object.keys(all).find(k => k === page.id || k.includes(page.id)) || page.id;
      const p = all[key] || {};
      $('tpProfile').replaceChildren(h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: `Hồ sơ Page: ${page.name}` })),
        h('form', { className: 'form-grid', onsubmit: async e => {
          e.preventDefault(); const f = new FormData(e.target); const cur = await DB.get(PROFILES, {});
          cur[key] = { ...(cur[key] || {}), niche: String(f.get('niche')), audience: String(f.get('audience')), voice: String(f.get('voice')), updatedAt: Date.now() };
          await DB.set(PROFILES, cur); toast('Đã lưu hồ sơ Page.');
        } },
          h('label', { className: 'field' }, 'Ngành / sản phẩm', h('textarea', { name: 'niche', value: p.niche || '', style: 'min-height:60px' })),
          h('label', { className: 'field' }, 'Khách hàng', h('textarea', { name: 'audience', value: p.audience || '', style: 'min-height:60px' })),
          h('label', { className: 'field' }, 'Giọng văn', h('textarea', { name: 'voice', value: p.voice || '', style: 'min-height:60px' })),
          h('div', { className: 'field wide' }, h('button', { className: 'btn btn-primary', textContent: 'Lưu hồ sơ', style: 'justify-self:start' }))));
    }
  });
})();
