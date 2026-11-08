/* Cài đặt: nhập dữ liệu từ tiện ích / khôi phục sao lưu, xuất sao lưu, quy tắc Hộp thư (InboxRules), thông báo tin mới, xoá dữ liệu. */
(() => {
  const BY_ID = ['templates', 'categories', 'tags', 'shopOrdersV1', 'inboxApptsV1', 'fbScheduleQueueV1'];
  const MERGE = ['metaCrmV1', 'customerNotes', 'conversationTags', 'templateStatsV1', 'fanpageProfilesV1', 'marketingPageTopicsV1', 'aiTopicChoicesV1'];
  const REPLACE = ['inboxSettingsV1', 'fbScheduleSettingsV1', 'marketingTopicLibraryV1', 'marketingContactPhoneV1'];

  // Gộp file sao lưu (tiện ích: nút "Xuất dữ liệu sang web", hoặc file sao lưu của chính trang này) vào dữ liệu hiện có.
  App.importData = async json => {
    const data = json?.data && typeof json.data === 'object' ? json.data : json;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('File không đúng định dạng.');
    const known = [...BY_ID, ...MERGE, ...REPLACE, 'settings'];
    if (!known.some(k => k in data)) throw new Error('File không có dữ liệu của Meta Assistant (mẫu tin, khách, đơn, lịch đăng…).');
    const report = [];
    for (const key of BY_ID) {
      if (!Array.isArray(data[key])) continue;
      let incoming = data[key];
      if (key === 'fbScheduleQueueV1') incoming = incoming.map(i => {
        const page = App.planner.pageOf(i);
        const status = i.status === 'local' ? 'approved' : i.status === 'scheduling' ? 'error' : i.status;
        return { ...i, ...(page ? { pageKey: page.id, pageName: page.name } : {}), status, ...(i.status === 'scheduling' ? { error: 'Đang lên lịch dở trên tiện ích: kiểm tra lại trên Facebook.' } : {}) };
      });
      const cur = await DB.get(key, []);
      const map = new Map(cur.map(x => [x.id, x]));
      incoming.filter(x => x && typeof x === 'object').forEach(x => { const id = x.id ?? uid('x'); map.set(id, { ...x, id }); });
      await DB.set(key, [...map.values()]);
      report.push(`${key}: ${incoming.length}`);
    }
    for (const key of MERGE) if (data[key] && typeof data[key] === 'object') { await DB.set(key, { ...(await DB.get(key, {})), ...data[key] }); report.push(`${key}: ${Object.keys(data[key]).length}`); }
    for (const key of REPLACE) if (data[key] != null) { await DB.set(key, data[key]); report.push(key); }
    if (data.settings) {
      const cur = await DB.get('settings', {});
      await DB.set('settings', { ...cur, ...data.settings, templateVars: { ...(cur.templateVars || {}), ...(data.settings.templateVars || {}) } });
      App.templateVars = (await DB.get('settings', {})).templateVars || {};
    }
    return report;
  };

  App.tab('settings', {
    mount(el) {
      el.append(
        h('div', { className: 'card', id: 'srvCard' }),
        h('div', { className: 'card' },
          h('h3', { className: 'card-title', textContent: 'Dữ liệu' }),
          h('p', { className: 'muted', textContent: 'Dữ liệu (mẫu tin, khách, đơn, lịch đăng…) lưu trên trình duyệt này. Dùng máy/trình duyệt khác thì xuất sao lưu rồi nhập ở đó.' }),
          h('div', { className: 'row' },
            h('label', { className: 'btn btn-primary' }, 'Nhập dữ liệu (từ tiện ích hoặc file sao lưu)', h('input', { type: 'file', id: 'stImport', accept: '.json,application/json', hidden: true, onchange: e => doImport(e.target.files[0]) })),
            h('button', { className: 'btn btn-ghost', textContent: 'Xuất sao lưu', onclick: async () => download(`meta_assistant_web_${Pure.dayKeyOf(Date.now())}.json`,
              JSON.stringify({ app: 'meta-assistant-web', version: 1, exportedAt: new Date().toISOString(), data: await DB.all() })) }),
            h('button', { className: 'btn btn-danger', textContent: 'Xoá dữ liệu trên trình duyệt này', onclick: async () => {
              if (!confirm('Xoá hết mẫu tin, khách, đơn, lịch đăng… trên trình duyệt này? Nên xuất sao lưu trước.')) return;
              await DB.clear(); toast('Đã xoá. Mẫu tin mặc định sẽ được nạp lại.'); setTimeout(() => location.reload(), 800);
            } })),
          h('p', { className: 'hint', textContent: 'Lấy dữ liệu từ tiện ích: mở bảng tiện ích, bấm nút "Xuất dữ liệu sang trang web" (cạnh nút Cài đặt), rồi nhập file vừa tải về ở đây.' }),
          h('div', { className: 'log', id: 'stLog' }),
          h('p', { className: 'hint' }, h('a', { href: 'privacy.html', target: '_blank', textContent: 'Chính sách quyền riêng tư' }), ' · ', h('a', { href: 'terms.html', target: '_blank', textContent: 'Điều khoản' }), ' · ', h('a', { href: 'data-deletion.html', target: '_blank', textContent: 'Xoá dữ liệu' }))),
        h('form', { className: 'card', id: 'stRules' }));
    },
    async refresh() { drawRules(); App.server?.drawCard(); }
  });
  async function doImport(file) {
    if (!file) return;
    $('stLog').replaceChildren();
    try {
      const report = await App.importData(JSON.parse(await file.text()));
      $('stLog').append(h('div', { className: 'status ok', textContent: `Đã nhập: ${report.join(' · ') || 'không có mục nào'}` }));
    } catch (e) { $('stLog').append(h('div', { className: 'status err', textContent: `Không nhập được: ${e.message}` })); }
    $('stImport').value = '';
  }

  async function drawRules() {
    const s = InboxRules.withDefaults(await DB.get(InboxRules.SETTINGS_KEY));
    const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    $('stRules').replaceChildren(
      h('h3', { className: 'card-title', textContent: 'Hộp thư & thông báo' }),
      h('div', { className: 'form-grid section-gap' },
        h('label', { className: 'field' }, 'Cảnh báo khách chờ quá (phút)', h('input', { type: 'number', name: 'waitMinutes', min: 1, value: s.waitMinutes })),
        h('label', { className: 'field' }, 'Kiểm tra tin mới mỗi (phút)', h('input', { type: 'number', name: 'pollMinutes', min: 1, value: s.pollMinutes || 2 })),
        h('label', { className: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', name: 'autoTag', checked: s.autoTag }), 'Tự gắn nhãn theo lời khách'),
        h('label', { className: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', name: 'webNotify', checked: !!s.webNotify }), 'Báo tin nhắn mới khi trang đang mở')),
      h('label', { className: 'field section-gap' }, 'Quy tắc gắn nhãn (mỗi dòng: Nhãn: từ khoá 1, từ khoá 2)',
        h('textarea', { name: 'rules', value: s.rules.filter(r => !r.phone).map(r => `${r.label}: ${(r.words || []).join(', ')}`).join('\n'), style: 'min-height:90px' })),
      h('label', { className: 'row', style: 'gap:6px;margin-top:8px' }, h('input', { type: 'checkbox', name: 'phoneRule', checked: s.rules.some(r => r.phone) }), 'Gắn nhãn khi khách gửi số điện thoại:',
        h('input', { type: 'text', name: 'phoneLabel', value: s.rules.find(r => r.phone)?.label || 'Có SĐT', style: 'width:140px' })),
      h('div', { className: 'row section-gap' },
        h('label', { className: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', name: 'quiet', checked: s.quiet }), 'Giờ yên lặng từ'),
        h('input', { type: 'time', name: 'quietFrom', value: s.quietFrom }), 'đến', h('input', { type: 'time', name: 'quietTo', value: s.quietTo })),
      h('details', { className: 'section-gap' }, h('summary', { className: 'muted', textContent: `Tắt thông báo cho Page (${s.mutedPages.length} đang tắt)` }),
        h('div', { className: 'pages', style: 'margin-top:8px' }, ...App.pages.map(p => h('label', {}, h('input', { type: 'checkbox', name: 'muted', value: p.id, checked: s.mutedPages.includes(p.id) }), p.name)))),
      h('div', { className: 'row section-gap' }, h('button', { className: 'btn btn-primary', textContent: 'Lưu cài đặt' }),
        perm === 'default' ? h('button', { type: 'button', className: 'btn btn-soft', textContent: 'Cho phép trình duyệt hiện thông báo', onclick: () => Notification.requestPermission().then(drawRules) }) : null,
        h('span', { className: 'hint', textContent: perm === 'granted' ? 'Trình duyệt đã cho phép thông báo.' : perm === 'denied' ? 'Trình duyệt đang chặn thông báo: trang sẽ hiện thông báo trong trang.' : '' })));
    $('stRules').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const rules = String(f.get('rules')).split('\n').map(l => { const i = l.indexOf(':'); return i < 0 ? [] : [l.slice(0, i), l.slice(i + 1)]; }).filter(([l, w]) => l?.trim() && w?.trim())
        .map(([l, w]) => ({ label: l.trim(), words: w.split(',').map(x => x.trim()).filter(Boolean) }));
      if (f.get('phoneRule')) rules.push({ label: String(f.get('phoneLabel')).trim() || 'Có SĐT', phone: true });
      await DB.set(InboxRules.SETTINGS_KEY, { ...s, waitMinutes: Math.max(1, Number(f.get('waitMinutes')) || 30), pollMinutes: Math.max(1, Number(f.get('pollMinutes')) || 2),
        autoTag: !!f.get('autoTag'), webNotify: !!f.get('webNotify'), rules, quiet: !!f.get('quiet'), quietFrom: f.get('quietFrom'), quietTo: f.get('quietTo'), mutedPages: f.getAll('muted').map(String) });
      if (f.get('webNotify') && typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
      toast('Đã lưu cài đặt.'); drawRules();
    };
  }
})();
