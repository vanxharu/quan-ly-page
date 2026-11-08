/* Gửi hàng loạt (giống bulk-tab.js): chọn khách → mẫu xoay vòng hoặc nội dung riêng → giãn cách ngẫu nhiên, nghỉ dài sau mỗi N tin.
 * Meta chỉ cho Page nhắn trong 24 giờ kể từ tin cuối của khách (tin ngoài khung bị từ chối và ghi lỗi). */
(() => {
  const S = { convs: [], running: false, stop: false };
  App.tab('bulk', {
    mount(el) {
      el.append(
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '1. Chọn khách' })),
          h('div', { className: 'toolbar' },
            h('button', { className: 'btn btn-soft', onclick: () => load() }, icon('i-sync'), 'Tải khách'),
            h('label', { className: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', id: 'bk24', checked: true, onchange: () => draw() }), 'Chỉ khách nhắn trong 24 giờ'),
            h('select', { id: 'bkLabel', style: 'width:auto', onchange: () => draw() }),
            h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Chọn hết', onclick: () => tick(true) }),
            h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Bỏ chọn', onclick: () => tick(false) })),
          h('div', { className: 'pages', id: 'bkList', style: 'max-height:280px' }, empty('Bấm "Tải khách".'))),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '2. Nội dung' })),
          h('div', { className: 'chips', style: 'margin-bottom:10px' },
            h('label', { className: 'chip' }, h('input', { type: 'radio', name: 'bkMode', value: 'tpl', checked: true }), ' Mẫu xoay vòng'),
            h('label', { className: 'chip' }, h('input', { type: 'radio', name: 'bkMode', value: 'text' }), ' Tự soạn')),
          h('div', { className: 'pages', id: 'bkTpls', style: 'max-height:200px' }),
          h('textarea', { id: 'bkText', placeholder: 'Nội dung tự soạn. Dùng được {tên_khách}, {tên}, {tên_page}…', style: 'margin-top:10px' })),
        h('div', { className: 'card' },
          h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '3. Tốc độ' })),
          h('div', { className: 'form-grid' },
            h('label', { className: 'field' }, 'Giãn cách từ (giây)', h('input', { type: 'number', id: 'bkMin', min: 3, value: 20 })),
            h('label', { className: 'field' }, 'đến (giây)', h('input', { type: 'number', id: 'bkMax', min: 3, value: 45 })),
            h('label', { className: 'field' }, 'Nghỉ dài sau mỗi (tin)', h('input', { type: 'number', id: 'bkEvery', min: 1, value: 10 })),
            h('label', { className: 'field' }, 'Nghỉ dài (giây)', h('input', { type: 'number', id: 'bkPause', min: 0, value: 120 }))),
          h('div', { className: 'row', style: 'margin-top:12px' },
            h('button', { className: 'btn btn-primary', id: 'bkStart', onclick: () => run() }, icon('i-send'), 'Bắt đầu gửi'),
            h('button', { className: 'btn btn-danger', id: 'bkStop', hidden: true, textContent: 'Dừng', onclick: () => { S.stop = true; } }),
            h('span', { className: 'hint', textContent: 'Giữ trang mở trong lúc gửi.' })),
          h('div', { className: 'progress' }, h('div', { id: 'bkBar' })),
          h('div', { className: 'log', id: 'bkLog' })));
    },
    async refresh() {
      const tpls = await App.templates.list();
      $('bkTpls').replaceChildren(...tpls.map(t => h('label', { title: t.content }, h('input', { type: 'checkbox', value: t.id }), t.title + (t.imageData ? ' 🖼' : ''))));
      const labels = await App.crm.allLabels();
      $('bkLabel').replaceChildren(h('option', { value: '', textContent: 'Mọi nhãn' }), ...labels.map(l => h('option', { value: l, textContent: l })));
    }
  });
  // Khách của mọi Page đang chọn ở trên cùng.
  async function load() {
    const pages = App.selected();
    $('bkList').replaceChildren(empty(`Đang tải khách của ${pages.length} Page…`));
    const errors = [];
    const lists = await pool(pages, 5, async page => {
      try {
        // Tối đa 3 trang (300 hội thoại gần nhất) mỗi Page: trước đây chỉ lấy 100 nên khách cũ hơn không bao giờ hiện.
        const data = await apiPaged(`/${page.id}/conversations`, { platform: 'messenger', limit: 100, fields: 'id,updated_time,participants,messages.limit(25){from,created_time}' }, page.access_token, 3);
        return (data || []).map(c => { const other = c.participants?.data.find(u => u.id !== page.id) || {};
          const lastCustomerAt = Math.max(0, ...(c.messages?.data || []).filter(m => m.from?.id === other.id).map(m => new Date(m.created_time).getTime()).filter(Number.isFinite));
          return { page, other, updated: new Date(c.updated_time).getTime(), lastCustomerAt, key: App.crmKey(page.id, other.name) }; });
      } catch (e) { errors.push(`${page.name}: ${e.message}`); return []; }
    });
    S.convs = lists.flat().sort((a, b) => b.updated - a.updated);
    S.crm = await App.crm.all();
    draw();
    errors.forEach(e => $('bkList').prepend(h('div', { className: 'status err', style: 'grid-column:1/-1', textContent: e })));
  }
  App.onPageChange.push(() => { S.convs = []; $('bkList')?.replaceChildren(empty('Bấm "Tải khách".')); });
  // Biết giờ tin cuối của khách mà đã quá 24 giờ: tin RESPONSE chắc chắn bị Meta từ chối.
  const outside24 = c => !!c.lastCustomerAt && Date.now() - c.lastCustomerAt >= 864e5;
  function visible() {
    const only24 = $('bk24').checked, lab = $('bkLabel').value;
    return S.convs.filter(c => c.other.id && (!only24 || (c.lastCustomerAt && Date.now() - c.lastCustomerAt < 864e5)) && (!lab || (S.crm?.[c.key]?.labels || []).includes(lab)));
  }
  function draw() {
    const list = visible();
    $('bkList').replaceChildren(...(list.length ? list.map(c => h('label', { title: `${c.page.name} · ${fmtTime(c.updated)}` }, h('input', { type: 'checkbox', value: `${c.page.id}|${c.other.id}`, checked: true }),
      App.avatar(c.page.name, App.pageAvatarUrl(c.page), 18), `${c.other.name || 'Khách'} · ${fmtShort(c.updated)}`))
      : [empty(S.convs.length ? 'Không có khách khớp điều kiện.' : 'Bấm "Tải khách".')]));
  }
  const tick = on => $('bkList').querySelectorAll('input').forEach(i => { i.checked = on; });
  const log = (cls, t) => $('bkLog').prepend(h('div', { className: 'status ' + cls, textContent: `${new Date().toLocaleTimeString('vi-VN')} · ${t}` }));

  async function run() {
    if (S.running) return;
    const ids = new Set([...$('bkList').querySelectorAll('input:checked')].map(i => i.value));
    const targets = visible().filter(c => ids.has(`${c.page.id}|${c.other.id}`));
    const mode = document.querySelector('[name=bkMode]:checked').value;
    const tplIds = [...$('bkTpls').querySelectorAll('input:checked')].map(i => i.value);
    const tpls = (await App.templates.list()).filter(t => tplIds.includes(t.id));
    const text = $('bkText').value.trim();
    if (!targets.length) return log('err', 'Chưa chọn khách nào.');
    if (mode === 'tpl' ? !tpls.length : !text) return log('err', mode === 'tpl' ? 'Chưa chọn mẫu.' : 'Chưa nhập nội dung.');
    const stale = targets.filter(outside24).length;
    if (!confirm(`Gửi tin cho ${targets.length} khách?${stale ? `\n${stale} khách đã quá 24 giờ kể từ tin cuối: Meta sẽ từ chối nên sẽ bỏ qua.` : ''}`)) return;
    const [min, max] = [Math.max(3, +$('bkMin').value || 20), Math.max(3, +$('bkMax').value || 45)].sort((a, b) => a - b);
    const every = Math.max(1, +$('bkEvery').value || 10), pause = Math.max(0, +$('bkPause').value || 0);
    S.running = true; S.stop = false; $('bkStart').disabled = true; $('bkStop').hidden = false;
    let ok = 0, fail = 0, skipped = 0, sent = 0;
    const blockedPages = new Set();
    for (let i = 0; i < targets.length && !S.stop; i++) {
      const c = targets[i], tpl = mode === 'tpl' ? tpls[sent % tpls.length] : null;
      const body = App.resolveVars(tpl ? tpl.content : text, { name: c.other.name || '', pageName: c.page.name });
      $('bkBar').style.width = `${Math.round((i + 1) / targets.length * 100)}%`;
      // Khung 24 giờ có thể hết trong lúc đang gửi một danh sách dài: kiểm lại ngay trước khi gửi từng khách.
      if (outside24(c)) { skipped++; log('pending', `↷ ${c.other.name}: đã quá 24 giờ từ tin cuối của khách, bỏ qua.`); continue; }
      if (blockedPages.has(c.page.id)) { skipped++; continue; }
      sent++;
      try {
        await App.sendMessage(c.page, c.other.id, body, tpl?.imageData);
        if (tpl) await App.recordTemplateUse(tpl, c.key);
        await App.crm.update(c.key, { pageId: c.page.id, pageName: c.page.name, name: c.other.name, psid: c.other.id, lastBulkAt: Date.now() });
        ok++; log('ok', `✓ ${c.other.name}${tpl ? ' · ' + tpl.title : ''}`);
      } catch (e) {
        fail++; log('err', `✗ ${c.other.name}: ${e.message}`);
        // Meta đang giới hạn: gửi tiếp chỉ làm khoá lâu hơn. Giới hạn của một Page → bỏ các khách còn lại của Page đó; của ứng dụng → dừng hẳn.
        if (e.rateLimited) {
          if (e.pageId) { blockedPages.add(String(e.pageId)); log('pending', `Tạm dừng gửi cho ${c.page.name} tới khi Meta mở lại.`); }
          else { log('err', 'Meta đang giới hạn ứng dụng: dừng gửi để tránh bị khoá lâu hơn.'); S.stop = true; }
          continue;
        }
      }
      if (i < targets.length - 1 && !S.stop) {
        const wait = (i + 1) % every === 0 ? pause : min + Math.random() * (max - min);
        if (wait) { log('pending', `Nghỉ ${Math.round(wait)} giây…`); for (let t = 0; t < wait * 10 && !S.stop; t++) await sleep(100); }
      }
    }
    log(S.stop ? 'pending' : 'ok', `${S.stop ? 'Đã dừng' : 'Xong'}: ${ok} thành công, ${fail} lỗi${skipped ? `, ${skipped} bỏ qua` : ''}.`);
    S.running = false; $('bkStart').disabled = false; $('bkStop').hidden = true;
  }
})();
