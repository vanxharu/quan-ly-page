/* Mẫu tin (giống tab Mẫu tin của tiện ích): nhóm, phím tắt "/", ảnh đính kèm, biến {tên_khách}…, thống kê lượt gửi.
 * Lưu: templates, categories, settings.templateVars, templateStatsV1 (cùng tên khoá với tiện ích để nhập dữ liệu thẳng). */
(() => {
  const VARS = [['name', 'Tên khách mặc định'], ['pageName', 'Tên Page/shop'], ['phone', 'SĐT'], ['hotline', 'Hotline'], ['address', 'Địa chỉ shop'],
    ['product', 'Sản phẩm'], ['price', 'Giá'], ['shipper', 'Đơn vị ship'], ['trackingCode', 'Mã vận đơn'], ['trackingLink', 'Link tra cứu']];
  let loaded = null;
  // Lần đầu: nạp bộ mẫu có sẵn của tiện ích (data/default-templates.json).
  async function ensure() {
    if (loaded) return loaded;
    loaded = (async () => {
      if (!(await DB.get('templates'))) {
        try {
          const d = await (await fetch('data/default-templates.json')).json();
          await DB.set('templates', d.templates || []); await DB.set('categories', d.categories || []); await DB.set('tags', d.tags || []);
        } catch { await DB.set('templates', []); }
      }
    })();
    return loaded;
  }
  const T = App.templates = {
    async list() { await ensure(); return DB.get('templates', []); },
    async categories() { await ensure(); return DB.get('categories', []); },
    // Khung chọn mẫu: ô tìm + nhóm + danh sách. onPick(tpl). Trả về { el, filter(q) }.
    picker(onPick) {
      let cat = '', q = '';
      const list = h('div', { className: 'tpl-list' });
      const chips = h('div', { className: 'chips' });
      const search = h('input', { type: 'search', placeholder: '🔍 Tìm mẫu hoặc phím tắt…', oninput: e => { q = e.target.value; draw(); } });
      async function draw() {
        const [tpls, cats] = [await T.list(), await T.categories()];
        chips.replaceChildren(...[{ id: '', name: 'Tất cả' }, ...cats].map(c => h('button', { type: 'button', className: 'chip', textContent: `${c.icon || ''} ${c.name}`.trim(),
          'aria-pressed': String(cat === c.id), onclick: () => { cat = c.id; draw(); } })));
        const s = norm(q.replace(/^\//, ''));
        const rows = tpls.filter(t => (!cat || t.category === cat) && (!s || norm(`${t.title} ${t.shortcut} ${t.content}`).includes(s)));
        list.replaceChildren(...(rows.length ? rows.map(t => h('div', { className: 'tpl-item', onclick: () => onPick(t) },
          t.imageData ? h('img', { className: 'thumb', src: t.imageData, alt: '' }) : null,
          h('div', {}, h('div', { className: 't', textContent: `${t.title}${t.shortcut ? '  /' + t.shortcut.replace(/^\//, '') : ''}` }), h('div', { className: 'c', textContent: t.content })))) : [h('div', { className: 'hint', textContent: 'Không có mẫu khớp.' })]));
      }
      draw();
      return { el: h('div', {}, search, h('div', { style: 'margin-top:8px' }, chips), list), filter(v) { q = v; search.value = v; draw(); }, first: async () => {
        const s = norm(q.replace(/^\//, '')); return (await T.list()).find(t => (!cat || t.category === cat) && (!s || norm(`${t.title} ${t.shortcut} ${t.content}`).includes(s)));
      } };
    }
  };

  let cat = '', editing = null;
  App.tab('templates', {
    mount(el) {
      el.append(
        h('div', { className: 'toolbar' },
          h('input', { type: 'search', className: 'grow', id: 'tplSearch', placeholder: '🔍 Tìm mẫu…', oninput: () => this.refresh() }),
          h('button', { className: 'btn btn-primary', onclick: () => { editing = {}; this.refresh(); } }, '+ Thêm mẫu')),
        h('div', { className: 'chips', id: 'tplCats', style: 'margin-bottom:12px' }),
        h('div', { id: 'tplEditor' }),
        h('div', { className: 'tpl-cards', id: 'tplCards' }),
        h('details', { className: 'card section-gap', id: 'tplVars' }, h('summary', { className: 'card-title', textContent: 'Biến mặc định trong mẫu' })),
        h('details', { className: 'card', id: 'tplStats' }, h('summary', { className: 'card-title', textContent: '📊 Thống kê mẫu tin' })));
    },
    async refresh() {
      const [tpls, cats] = [await T.list(), await T.categories()];
      if (cat && !cats.some(c => c.id === cat)) cat = ''; // nhóm vừa bị xoá
      const q = norm($('tplSearch').value);
      const current = cats.find(c => c.id === cat);
      $('tplCats').replaceChildren(...[{ id: '', name: 'Tất cả' }, ...cats].map(c => h('button', { type: 'button', className: 'chip', textContent: `${c.icon || ''} ${c.name}`.trim(),
        'aria-pressed': String(cat === c.id), onclick: () => { cat = c.id; this.refresh(); } })),
        h('button', { type: 'button', className: 'chip', textContent: '+ Nhóm', onclick: async () => {
          const name = prompt('Tên nhóm mẫu mới:'); if (!name?.trim()) return;
          await DB.set('categories', [...cats, { id: uid('cat'), name: name.trim(), icon: '📁', color: '#5B4FD8' }]); this.refresh();
        } }),
        // Đổi tên / xoá nhóm đang chọn. Xoá nhóm không xoá mẫu: mẫu chuyển sang "Không nhóm".
        current ? h('button', { type: 'button', className: 'chip', textContent: '✎ Đổi tên nhóm', onclick: async () => {
          const name = prompt('Tên mới của nhóm:', current.name); if (!name?.trim()) return;
          await DB.set('categories', (await T.categories()).map(c => c.id === current.id ? { ...c, name: name.trim() } : c)); this.refresh();
        } }) : null,
        current ? h('button', { type: 'button', className: 'chip', textContent: '🗑 Xoá nhóm', onclick: async () => {
          const used = (await T.list()).filter(t => t.category === current.id).length;
          if (!confirm(`Xoá nhóm "${current.name}"?${used ? ` ${used} mẫu trong nhóm sẽ chuyển sang "Không nhóm".` : ''}`)) return;
          await DB.set('categories', (await T.categories()).filter(c => c.id !== current.id));
          await DB.set('templates', (await T.list()).map(t => t.category === current.id ? { ...t, category: '' } : t));
          cat = ''; this.refresh();
        } }) : null);
      const catName = id => cats.find(c => c.id === id)?.name || 'Không nhóm';
      const rows = tpls.filter(t => (!cat || t.category === cat) && (!q || norm(`${t.title} ${t.shortcut} ${t.content}`).includes(q)));
      $('tplCards').replaceChildren(...(rows.length ? rows.map(t => h('div', { className: 'tpl-card' },
        h('div', { className: 'row' }, h('strong', { className: 'grow', textContent: t.title }), t.shortcut ? h('span', { className: 'tag', textContent: '/' + t.shortcut.replace(/^\//, '') }) : null),
        h('div', { className: 'hint', textContent: catName(t.category) }),
        t.imageData ? h('img', { src: t.imageData, alt: '', style: 'max-height:120px;object-fit:contain;border-radius:8px;align-self:flex-start' }) : null,
        h('div', { className: 'content', textContent: t.content }),
        h('div', { className: 'actions' },
          h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Chép', onclick: () => navigator.clipboard.writeText(App.resolveVars(t.content)).then(() => toast('Đã chép nội dung mẫu.')) }),
          h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Sửa', onclick: () => { editing = t; this.refresh(); scrollTo({ top: 0, behavior: 'smooth' }); } }),
          h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Nhân bản', onclick: () => {
            const { id, shortcut, ...rest } = t; editing = { ...rest, title: `${t.title} (bản sao)` }; this.refresh(); scrollTo({ top: 0, behavior: 'smooth' });
          } }),
          // Đọc lại danh sách lúc bấm: danh sách lúc vẽ có thể đã cũ (vừa thêm/sửa ở chỗ khác) và ghi đè làm mất mẫu.
          h('button', { className: 'btn btn-danger btn-sm', textContent: 'Xoá', onclick: async () => {
            if (!confirm(`Xoá mẫu "${t.title}"?`)) return; await DB.set('templates', (await T.list()).filter(x => x.id !== t.id)); this.refresh();
          } })))) : [empty('Không có mẫu khớp.')]));
      $('tplEditor').replaceChildren(editing ? editor(editing.id || editing.category != null ? editing : { ...editing, category: cat }, cats, () => { editing = null; this.refresh(); }) : '');
      // Biến mặc định
      const settings = await DB.get('settings', {});
      const vars = settings.templateVars || {};
      $('tplVars').replaceChildren($('tplVars').firstChild, h('p', { className: 'hint', textContent: 'Dùng trong mẫu: {tên_khách} {tên} {họ} {danh_xưng} {tên_page} {sdt} {hotline} {địa_chỉ} {sản_phẩm} {giá} {đơn_vị_ship} {mã_vận_đơn} {link_tra_cứu}. Tên khách lấy theo hội thoại đang mở.' }),
        h('form', { className: 'form-grid', onsubmit: async e => {
          e.preventDefault(); const f = new FormData(e.target);
          App.templateVars = Object.fromEntries(VARS.map(([k]) => [k, String(f.get(k) || '').trim()]));
          await DB.set('settings', { ...settings, templateVars: App.templateVars }); toast('Đã lưu biến mặc định.');
        } }, ...VARS.map(([k, label]) => h('label', { className: 'field' }, label, h('input', { type: 'text', name: k, value: vars[k] || '' }))),
          h('div', { className: 'field wide' }, h('button', { className: 'btn btn-primary', textContent: 'Lưu biến', style: 'justify-self:start' }))));
      // Thống kê
      const stats = Pure.summarizeTemplates(await DB.get('templateStatsV1', {}), await App.crm.all());
      $('tplStats').replaceChildren($('tplStats').firstChild, stats.length ? h('div', { className: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['Mẫu', 'Lượt gửi', 'Khách', 'Chốt'].map((t, i) => h('th', { className: i ? '' : 'left', textContent: t })))),
        h('tbody', {}, ...stats.map(r => h('tr', {}, h('td', { className: 'left', textContent: r.title }), h('td', { textContent: r.sent }), h('td', { textContent: r.customers }),
          h('td', { textContent: `${r.won}${r.customers ? ` (${r.rate}%)` : ''}` })))))) : h('p', { className: 'hint', textContent: 'Chưa có số liệu. Gửi mẫu từ Hộp thư để bắt đầu thống kê.' }),
        h('p', { className: 'hint', textContent: '"Chốt" = khách nhận mẫu hiện ở giai đoạn hoặc có nhãn "Đã chuyển đổi".' }));
    }
  });

  function editor(t, cats, close) {
    let image = t.imageData || '';
    const preview = h('div', { className: 'attach' });
    const drawPreview = () => preview.replaceChildren(...(image ? [h('img', { className: 'thumb', src: image, alt: '' }), h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Bỏ ảnh', onclick: () => { image = ''; drawPreview(); } })] : []));
    drawPreview();
    return h('form', { className: 'card', onsubmit: async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const item = { id: t.id || uid('tpl'), title: String(f.get('title')).trim(), category: String(f.get('category')), shortcut: String(f.get('shortcut')).trim().replace(/^\//, ''),
        content: String(f.get('content')), ...(image ? { imageData: image } : {}) };
      const list = await T.list();
      const clash = item.shortcut && list.find(x => x.id !== item.id && String(x.shortcut || '').replace(/^\//, '').toLowerCase() === item.shortcut.toLowerCase());
      if (clash && !confirm(`Phím tắt /${item.shortcut} đang dùng cho mẫu "${clash.title}". Gõ /${item.shortcut} sẽ ra mẫu nào trước thì khó đoán. Vẫn lưu?`)) return;
      await DB.set('templates', t.id ? list.map(x => x.id === t.id ? item : x) : [...list, item]);
      toast('Đã lưu mẫu.'); close();
    } },
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: t.id ? 'Sửa mẫu' : 'Mẫu mới' })),
      h('div', { className: 'form-grid' },
        h('label', { className: 'field' }, 'Tiêu đề', h('input', { type: 'text', name: 'title', required: true, value: t.title || '' })),
        h('label', { className: 'field' }, 'Nhóm', h('select', { name: 'category' }, h('option', { value: '', textContent: 'Không nhóm', selected: !t.category }), ...cats.map(c => h('option', { value: c.id, textContent: c.name, selected: c.id === t.category })))),
        h('label', { className: 'field' }, 'Phím tắt (gõ /…)', h('input', { type: 'text', name: 'shortcut', value: t.shortcut || '' })),
        h('label', { className: 'field wide' }, 'Nội dung', h('textarea', { name: 'content', required: true, value: t.content || '' })),
        h('label', { className: 'field wide' }, 'Ảnh đính kèm (gửi sau chữ)', h('input', { type: 'file', accept: 'image/*', onchange: async e => {
          const file = e.target.files[0]; if (!file) return;
          if (file.size > 8e6) return toast('Ảnh quá 8MB, Messenger sẽ từ chối.');
          image = await fileToDataUrl(file); drawPreview();
        } }), preview)),
      h('div', { className: 'row' }, h('button', { className: 'btn btn-primary', textContent: 'Lưu mẫu' }), h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: close })));
  }
})();
