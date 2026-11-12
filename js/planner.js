/* Lịch đăng (giống post-schedule.js): hàng chờ bài nháp → xếp giờ tự động trong khung tương tác (Pure.planTimes) → duyệt →
 * "Lên lịch tất cả bài đã duyệt" hẹn thẳng trên Facebook qua Graph API (Facebook tự đăng, không cần mở máy).
 * Lưu: fbScheduleQueueV1 (hàng chờ), fbScheduleSettingsV1 (khung giờ, bài/ngày, ngày trong tuần, ngày đăng, cấu hình riêng từng Page). */
(() => {
  const QUEUE = 'fbScheduleQueueV1', SETTINGS = 'fbScheduleSettingsV1';
  const running = new Set(); // bài đang lên lịch trong phiên này
  const STATUS = { draft: ['Chờ duyệt', 'pending'], approved: ['Đã duyệt', 'ok'], scheduling: ['Đang lên lịch…', 'pending'], scheduled: ['Đã hẹn trên FB', 'ok'],
    local: ['Chờ đăng (tiện ích)', 'pending'], posted: ['Đã đăng', 'ok'], missed: ['Lỡ giờ', 'err'], error: ['Lỗi', 'err'] };
  const defaults = () => ({ windows: Pure.DEFAULT_WINDOWS, perDay: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], days: [], pages: {} });
  let scope = 'default', filterStatus = '';
  // Bài thuộc Page đang chọn (bài chưa rõ Page luôn hiện để chọn lại Page).
  const inSel = i => !App.planner.pageOf(i) || App.isSelected(App.planner.pageOf(i).id);
  App.planner = { STATUS, pageOf: item => App.pageById(item.pageKey) || App.pages.find(p => String(item.pageKey || '').includes(p.id)) || App.pages.find(p => norm(p.name) === norm(item.pageName)) };
  const pageOf = App.planner.pageOf;
  const getSettings = async () => ({ ...defaults(), ...(await DB.get(SETTINGS, {})) });
  const cfgFor = (s, key) => {
    const src = s.pages?.[key] || s;
    return { windows: Pure.parseWindows(src.windows ?? s.windows), perDay: Math.min(5, Math.max(1, Number(src.perDay) || 1)),
      weekdays: Array.isArray(src.weekdays) ? src.weekdays : s.weekdays, ...(Array.isArray(src.days) && s.pages?.[key] ? { days: src.days } : {}) };
  };

  App.tab('planner', {
    mount(el) {
      el.append(
        h('div', { className: 'planner-ai-action' },
          h('button',{type:'button',id:'plCompose',className:'btn btn-ghost',textContent:'Soạn tay',onclick:()=>App.posting.open()}),
          h('button', { type: 'button', className: 'btn btn-primary', 'data-ai-sidepanel':'1',textContent: '✦ Mở Studio AI', onclick: e => App.ai.open({ mode: 'planner', trigger: e.currentTarget }) })),
        h('div',{id:'plComposer'}),
        h('div', { className: 'grid2' },
          h('div', { className: 'card', id: 'plCfg' }),
          h('div', { className: 'card', id: 'plDays' })),
        h('div', { className: 'card' },
          h('div', { className: 'toolbar' },
            h('select', { id: 'plStatus', style: 'width:auto', onchange: e => { filterStatus = e.target.value; this.refresh(); } },
              h('option', { value: '', textContent: 'Mọi trạng thái' }), ...Object.entries(STATUS).map(([k, [t]]) => h('option', { value: k, textContent: t }))),
            h('span', { className: 'grow' }),
            h('button', { className: 'btn btn-soft', onclick: () => autoTime() }, icon('i-cal'), 'Xếp giờ tự động'),
            h('button', { className: 'btn btn-ghost', onclick: () => approveAll() }, '✓ Duyệt tất cả nháp'),
            h('button', { className: 'btn btn-danger', id: 'plDeleteAll', onclick: () => deleteAll() }, 'Xoá tất cả bài'),
            h('button', { className: 'btn btn-primary', id: 'plGo', onclick: () => scheduleAll() }, icon('i-send'), 'Lên lịch tất cả bài đã duyệt')),
          h('div', { className: 'log', id: 'plLog' }),
          h('div', { id: 'plList', className: 'section-gap' })));
      App.posting?.mount($('plComposer'));
    },
    async refresh() {
      if(!$('plCfg'))return; // Có thể nhận bài AI trước lần mở tab Lịch đăng.
      App.posting?.refresh();
      const s = await getSettings();
      let queue = await DB.get(QUEUE, []);
      // "Đang lên lịch…" còn lại từ lần trước (app đóng / tải lại giữa chừng): không còn chạy nữa → báo lỗi để bạn kiểm tra rồi lên lịch lại.
      if (queue.some(i => i.status === 'scheduling' && !running.has(i.id))) {
        queue = queue.map(i => i.status === 'scheduling' && !running.has(i.id) ? { ...i, status: 'error', error: 'Lần lên lịch trước bị ngắt (app đóng hoặc tải lại). Xem Business Suite › Lịch xem bài đã hẹn chưa; chưa có thì bấm Lên lịch lại.' } : i);
        await DB.set(QUEUE, queue);
      }
      // Bài đã hẹn trên FB mà qua giờ → coi như đã đăng.
      if (queue.some(i => i.status === 'scheduled' && i.at < Date.now())) {
        queue = queue.map(i => i.status === 'scheduled' && i.at < Date.now() ? { ...i, status: 'posted' } : i); await DB.set(QUEUE, queue);
      }
      App.planner.messageButtonDefault = !!s.messageButton;
      drawCfg(s); drawDays(s);
      const list = queue.filter(i => inSel(i) && (!filterStatus || i.status === filterStatus))
        .sort((a, b) => (a.at || 0) - (b.at || 0));
      const groups = new Map();
      for (const i of list) { const k = i.at ? new Date(i.at).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' }) : 'Chưa xếp giờ'; (groups.get(k) || groups.set(k, []).get(k)).push(i); }
      $('plList').replaceChildren(...(list.length ? [...groups].flatMap(([day, items]) => [h('h4', { className: 'card-title', style: 'margin:14px 0 8px', textContent: `${day} (${items.length})` }), ...items.map(itemEl)])
        : [empty('Chưa có bài trong lịch. Bấm Tạo bài bằng AI, chọn Page và số bài để bắt đầu.')]));
    }
  });
  const refresh = () => App.tabs.planner.refresh();
  App.planner.revealDrafts=()=>{filterStatus='draft';if($('plStatus'))$('plStatus').value='draft';return refresh();};
  const log = (cls, t) => $('plLog').append(h('div', { className: 'status ' + cls, textContent: t }));
  async function patch(id, change) {
    const queue = await DB.get(QUEUE, []);
    await DB.set(QUEUE, queue.map(i => i.id === id ? { ...i, ...change } : i));
  }

  function choosePage(item, locked) {
    if(locked)return;
    document.querySelector('.planner-page-dialog')?.close();
    let saving=false;
    const current=pageOf(item),list=h('div',{className:'planner-page-options'}),error=h('p',{className:'status err',hidden:true,role:'alert'});
    const search=App.pageSearchField?App.pageSearchField({placeholder:'Tìm tên hoặc ID Page…','aria-label':'Tìm Fanpage'}):h('input',{type:'search',autocomplete:'off',placeholder:'Tìm tên hoặc ID Page…','aria-label':'Tìm Fanpage'});
    const key=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
    const dialog=h('dialog',{className:'planner-page-dialog','aria-label':'Chọn Fanpage nhận bài',onclose:()=>{
      dialog.remove();[...document.querySelectorAll('.planner-page-trigger')].find(button=>button.dataset.itemId===item.id)?.focus?.();
    }});
    const draw=()=>{
      const pages=App.pages.filter(page=>key(page.name+' '+page.id).includes(key(search.value)));
      list.replaceChildren(...pages.map(page=>h('button',{type:'button',className:'planner-page-option','aria-pressed':String(page.id===current?.id),disabled:saving,onclick:async()=>{
        if(saving)return;saving=true;search.disabled=true;list.querySelectorAll('button').forEach(button=>button.disabled=true);error.hidden=true;
        try{await patch(item.id,{pageKey:page.id,pageName:page.name});await refresh();dialog.close();}
        catch(e){saving=false;search.disabled=false;error.textContent='Chưa đổi được Page: '+e.message;error.hidden=false;draw();}
      }},App.avatar(page.name,App.pageAvatarUrl(page),38),
        h('span',{className:'planner-page-copy'},h('strong',{textContent:page.name}),h('small',{textContent:'ID '+page.id})),
        h('span',{className:'planner-page-check','aria-hidden':'true',textContent:page.id===current?.id?'✓':''}))),
        ...(pages.length?[]:[h('p',{className:'hint',textContent:'Không tìm thấy Page phù hợp.'})]));
    };
    search.oninput=draw;
    dialog.append(h('div',{className:'planner-page-dialog-head'},h('h3',{textContent:'Chọn Fanpage'}),h('button',{type:'button',className:'icon-btn','aria-label':'Đóng chọn Page',textContent:'×',onclick:()=>dialog.close()})),search,error,list);
    document.body.append(dialog);draw();dialog.showModal();search.focus?.();
  }

  function itemEl(i) {
    const page = pageOf(i), [label, tone] = STATUS[i.status] || [i.status, 'pending'];
    const locked = ['scheduled', 'posted', 'scheduling'].includes(i.status);
    return h('div', { className: 'qitem' },
      i.imageData ? h('img', { className: 'thumb', src: i.imageData, alt: '', style: 'width:64px;height:64px' }) : h('span'),
      h('div', {},
        h('div', { className: 'meta' },
          h('div', { className: 'planner-page-picker', title: page ? `${page.name} · ID ${page.id}` : i.pageName || 'Chọn Page nhận bài' },
            h('button',{type:'button',className:'planner-page-trigger',dataset:{itemId:i.id},'aria-label':'Page nhận bài: '+(page?.name||i.pageName||'Chưa chọn'),'aria-haspopup':'dialog',disabled:locked,onclick:()=>choosePage(i,locked)},
              App.avatar(page?.name||i.pageName||'Page',App.pageAvatarUrl(page),32),
              h('span',{className:'planner-page-copy'},h('strong',{textContent:page?.name||i.pageName||'Chọn Fanpage'}),h('small',{textContent:page?'ID '+page.id:'Page chưa kết nối · Chọn lại'})),
              h('span',{'aria-hidden':'true',textContent:'⌄'}))),
          h('input', { type: 'datetime-local', value: toLocalInput(i.at), disabled: locked, onchange: e => patch(i.id, { at: e.target.value ? new Date(e.target.value).getTime() : 0 }).then(refresh) }),
          h('span', { className: 'status ' + tone, textContent: i.aiGenerating?'Đang tạo ảnh…':label }),
          i.imageRequired&&!i.imageData?h('span',{className:'status err',textContent:'Thiếu ảnh · Chưa thể lên lịch'}):null,
          h('label', { className: 'row planner-msg-btn', style: 'gap:6px', title: i.imageData ? 'Bài có ảnh: tạo qua tài khoản quảng cáo (không tốn tiền) để giữ ảnh + nút; máy chủ bot đăng đúng giờ.' : 'Gắn nút Gửi tin nhắn (Messenger) dưới bài.' },
            h('input', { type: 'checkbox', checked: i.messageButton ?? !!App.planner?.messageButtonDefault, disabled: locked, onchange: e => patch(i.id, { messageButton: e.target.checked }) }), 'Nút Gửi tin nhắn'),
          i.error ? h('span', { className: 'hint', textContent: i.error }) : null),
        i.topicTitle?h('p',{className:'hint',textContent:'Chủ đề: '+i.topicTitle}):null,
        ...MetaAIProtocol.sources(i.sources).map(ref=>h('a',{className:'hint',href:ref.url,target:'_blank',rel:'noopener noreferrer',textContent:'Nguồn Reddit · '+(ref.title||'Xem bài gốc')})),
        h('textarea', { value: i.text || '', disabled: locked, onchange: e => patch(i.id, { text: e.target.value }) })),
      h('div', { className: 'acts' },
        !i.aiGenerating&&(!i.imageRequired||!!i.imageData)&&['draft', 'error', 'missed'].includes(i.status) ? h('button', { className: 'btn btn-soft btn-sm', textContent: '✓ Duyệt', onclick: () => patch(i.id, { status: 'approved', error: '' }).then(refresh) }) : null,
        i.status === 'approved' ? h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Bỏ duyệt', onclick: () => patch(i.id, { status: 'draft' }).then(refresh) }) : null,
        i.status === 'approved' ? h('button', { className: 'btn btn-primary btn-sm', textContent: 'Lên lịch', onclick: () => scheduleOne(i).then(refresh) }) : null,
        i.status === 'scheduled' && page ? App.metaLink(App.metaScheduledUrl(page.id)) : null,
        i.status === 'posted' && i.fbPostId ? App.metaLink(App.metaPostUrl(i.fbPostId), 'Xem bài ↗') : null,
        h('button', { className: 'btn btn-danger btn-sm', textContent: 'Xoá', onclick: () => askDelete([i]) })));
  }

  // Sau khi hẹn: link mở lịch hẹn của từng Page trên Meta Business Suite để kiểm tra trực tiếp.
  function logLinks(pages) {
    const unique = [...new Map(pages.map(p => [p.id, p])).values()];
    if (unique.length) $('plLog').append(h('div', { className: 'row planner-meta-links' }, h('span', { className: 'hint', textContent: 'Xem lịch hẹn trên Meta:' }),
      ...unique.map(p => App.metaLink(App.metaScheduledUrl(p.id), p.name + ' ↗'))));
  }
  // ── Xoá bài ───────────────────────────────────────────────
  // Bài đã hẹn trên Facebook: cho chọn chỉ xoá khỏi danh sách (bài vẫn tự đăng) hay huỷ luôn trên Facebook.
  // Bài đã đăng không bao giờ bị xoá khỏi Facebook ở đây.
  function askDelete(items) {
    if (!items.length) return;
    document.querySelector('.planner-delete-dialog')?.close();
    const onFb = items.filter(i => i.status === 'scheduled' && i.fbPostId);
    let busy = false;
    const choice = h('div', { className: 'planner-delete-choice' },
      h('label', {}, h('input', { type: 'radio', name: 'plDelMode', value: 'fb', checked: true }), ` Huỷ luôn ${onFb.length} bài đã hẹn trên Facebook (bài sẽ không được đăng)`),
      h('label', {}, h('input', { type: 'radio', name: 'plDelMode', value: 'list' }), ' Chỉ xoá khỏi danh sách này (bài đã hẹn vẫn tự đăng trên Facebook)'));
    const error = h('p', { className: 'status err', hidden: true, role: 'alert' });
    const go = h('button', { type: 'button', className: 'btn btn-danger', textContent: `Xoá ${items.length} bài`, onclick: async () => {
      if (busy) return; busy = true; go.disabled = true; go.textContent = 'Đang xoá…';
      const cancelFb = onFb.length > 0 && dialog.querySelector('input[name=plDelMode]:checked')?.value === 'fb';
      const result = await deleteItems(items, cancelFb);
      busy = false; dialog.close();
      log(result.failed.length ? 'err' : 'ok', `Đã xoá ${result.removed} bài khỏi danh sách${cancelFb ? `, huỷ ${result.cancelled} bài hẹn trên Facebook` : ''}.${result.failed.length ? ' Chưa huỷ được: ' + result.failed.join('; ') + '. Các bài này vẫn giữ trong danh sách.' : ''}`);
      refresh();
    } });
    const dialog = h('dialog', { className: 'planner-page-dialog planner-delete-dialog', 'aria-label': 'Xoá bài', onclose: () => dialog.remove() },
      h('div', { className: 'planner-page-dialog-head' }, h('h3', { textContent: items.length > 1 ? `Xoá ${items.length} bài?` : 'Xoá bài này?' }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dialog.close() })),
      h('p', { className: 'hint', textContent: onFb.length ? `${onFb.length} bài đã được hẹn trên Facebook. Chọn cách xoá:` : 'Bài chưa được hẹn trên Facebook, chỉ xoá khỏi danh sách.' }),
      onFb.length ? choice : null, error,
      h('div', { className: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: () => dialog.close() }), go));
    document.body.append(dialog); dialog.showModal();
  }
  async function deleteItems(items, cancelFb) {
    const failed = [], keep = new Set(); let cancelled = 0;
    if (cancelFb) await pool(items.filter(i => i.status === 'scheduled' && i.fbPostId), 3, async i => {
      const page = pageOf(i);
      try { if (!page) throw Error('Page chưa kết nối'); await api(`/${i.fbPostId}`, {}, 'DELETE', page.access_token); cancelled++; }
      catch (e) { failed.push(`${page?.name || i.pageName || 'Page'}: ${e.message}`); keep.add(i.id); }
    });
    const ids = new Set(items.map(i => i.id).filter(id => !keep.has(id)));
    await DB.set(QUEUE, (await DB.get(QUEUE, [])).filter(x => !ids.has(x.id)));
    return { removed: ids.size, cancelled, failed };
  }
  async function deleteAll() {
    const items = (await DB.get(QUEUE, [])).filter(i => inSel(i) && (!filterStatus || i.status === filterStatus) && i.status !== 'scheduling');
    if (!items.length) return log('err', 'Không có bài nào để xoá trong danh sách đang hiện.');
    askDelete(items);
  }
  App.planner.deleteItems = deleteItems;

  async function scheduleOne(i) {
    if(i.aiGenerating)return patch(i.id,{status:'draft',error:'Chờ AI tạo và lưu ảnh xong trước khi duyệt.'});
    if(i.imageRequired&&!i.imageData)return patch(i.id,{status:'error',error:'Bài này cần có ảnh nhưng chưa nhận được ảnh. Bổ sung hoặc chuyển lại bản nháp có ảnh trước khi lên lịch.'});
    const page = pageOf(i);
    if (!page) return patch(i.id, { status: 'error', error: 'Không tìm thấy Page. Chọn lại Page cho bài.' });
    if (!i.at || i.at < Date.now() + 600e3) return patch(i.id, { status: 'error', error: 'Giờ đăng phải sau hiện tại ít nhất 10 phút.' });
    await patch(i.id, { status: 'scheduling' });
    running.add(i.id);
    try {
      const res = await App.publish(page, i.text, i.imageData, Math.floor(i.at / 1000), { messageButton: i.messageButton ?? !!App.planner?.messageButtonDefault });
      await patch(i.id, { status: 'scheduled', fbPostId: res.post_id || res.id, pageKey: page.id, pageName: page.name, error: '' });
      return true;
    } catch (e) { await patch(i.id, { status: 'error', error: e.message }); return false; }
    finally { running.delete(i.id); }
  }
  async function scheduleAll() {
    $('plLog').replaceChildren();
    const list = (await DB.get(QUEUE, [])).filter(i => i.status === 'approved' && inSel(i));
    if (!list.length) return log('err', 'Không có bài đã duyệt.');
    $('plGo').disabled = true;
    let ok = 0;
    for (const i of list) { if (await scheduleOne(i)) ok++; }
    $('plGo').disabled = false;
    log(ok === list.length ? 'ok' : 'err', `Đã hẹn ${ok}/${list.length} bài trên Facebook.${ok < list.length ? ' Bài lỗi ghi rõ lý do bên dưới.' : ''}`);
    if (ok) logLinks(list.map(i => pageOf(i)).filter(Boolean));
    refresh();
  }
  async function approveAll() {
    const queue = await DB.get(QUEUE, []);
    await DB.set(QUEUE, queue.map(i => i.status === 'draft' && !i.aiGenerating && (!i.imageRequired||!!i.imageData) && inSel(i) ? { ...i, status: 'approved' } : i));
    refresh();
  }
  async function autoTime() {
    $('plLog').replaceChildren();
    const s = await getSettings();
    const queue = await DB.get(QUEUE, []);
    const waiting = queue.filter(i => ['draft', 'approved'].includes(i.status) && !i.at && pageOf(i) && App.isSelected(pageOf(i).id));
    if (!waiting.length) return log('err', 'Không có bài nháp nào chưa xếp giờ.');
    const byKey = new Map();
    for (const i of waiting) { const k = pageOf(i).id; (byKey.get(k) || byKey.set(k, []).get(k)).push(i); }
    // Bỏ ngày đăng đã qua (không còn hiện trên lịch chọn) để không xếp 0 bài mà không rõ lý do.
    const days = Pure.activeDays(s.days);
    if ((s.days || []).some(d => !days.includes(d))) { s.days = (s.days || []).filter(d => days.includes(d)); await DB.set(SETTINGS, { ...(await DB.get(SETTINGS, {})), days: s.days }); }
    const live = queue.filter(i => i.at).map(i => ({ ...i, pageKey: pageOf(i)?.id || i.pageKey }));
    const plan = Pure.planTimes([...byKey.keys()].map(key => ({ key, cfg: cfgFor(s, key) })), days, live).filter(p => p.at).sort((a, b) => a.at - b.at);
    let n = 0;
    for (const slot of plan) { const item = byKey.get(slot.key)?.shift(); if (item) { item.at = slot.at; n++; } }
    await DB.set(QUEUE, queue);
    const left = [...byKey.values()].reduce((a, l) => a + l.length, 0);
    // Nói rõ lý do cho từng Page chưa xếp được (thiếu ngày trong tuần, khung giờ trống…), không chỉ báo chung chung.
    const why = [...byKey.entries()].filter(([, l]) => l.length).map(([key]) => {
      const cfg = cfgFor(s, key), name = App.pageById(key)?.name || key;
      if (!cfg.windows.length) return `${name}: khung giờ trống`;
      if (!cfg.weekdays?.length) return `${name}: chưa chọn ngày nào trong tuần (T2–CN)`;
      if (!days.some(d => cfg.weekdays.includes(new Date(d + 'T00:00').getDay()))) return `${name}: các ngày đăng đã chọn không rơi vào ngày trong tuần của Page này`;
      return `${name}: đã kín ${cfg.perDay} bài/ngày trong các ngày đã chọn`;
    });
    log(left ? 'pending' : 'ok', `Đã xếp giờ ${n} bài.${left ? ` Còn ${left} bài chưa có chỗ — ${why.join('; ')}. Chọn thêm ngày đăng, ngày trong tuần hoặc tăng số bài/ngày.` : ''}`);
    refresh();
  }

  // ── Khung giờ & ngày đăng ──────────────────────────────────
  function drawCfg(s) {
    const src = scope === 'default' ? s : (s.pages[scope] || { windows: s.windows, perDay: s.perDay, weekdays: [...s.weekdays] });
    const save = async change => {
      const next = await getSettings();
      if (scope === 'default') Object.assign(next, change); else next.pages[scope] = { ...(next.pages[scope] || { windows: next.windows, perDay: next.perDay, weekdays: [...next.weekdays] }), ...change };
      await DB.set(SETTINGS, next); refresh();
    };
    $('plCfg').replaceChildren(
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Khung giờ & số bài' }),
        h('select', { style: 'width:auto;max-width:200px', onchange: e => { scope = e.target.value; refresh(); } },
          h('option', { value: 'default', textContent: 'Mặc định mọi Page' }), ...App.selected().map(p => h('option', { value: p.id, textContent: (s.pages[p.id] ? '★ ' : '') + p.name, selected: p.id === scope })))),
      h('label', { className: 'field' }, 'Khung giờ tương tác', h('input', { type: 'text', value: src.windows ?? s.windows, placeholder: Pure.DEFAULT_WINDOWS,
        onchange: e => save({ windows: Pure.windowsLabel(Pure.parseWindows(e.target.value)) || Pure.DEFAULT_WINDOWS }) })),
      h('div', { className: 'row', style: 'margin-top:10px' },
        h('label', { className: 'row', style: 'gap:6px' }, 'Bài/ngày', h('select', { style: 'width:auto', onchange: e => save({ perDay: Number(e.target.value) }) },
          ...[1, 2, 3, 4, 5].map(n => h('option', { value: n, textContent: n, selected: Number(src.perDay) === n })))),
        h('div', { className: 'days' }, ...Pure.WEEKDAYS.map(([d, t]) => h('button', { type: 'button', className: 'chip', textContent: t, 'aria-pressed': String((src.weekdays || []).includes(d)),
          onclick: () => save({ weekdays: (src.weekdays || []).includes(d) ? src.weekdays.filter(x => x !== d) : [...(src.weekdays || []), d] }) })))),
      scope !== 'default' && s.pages[scope] ? h('button', { className: 'btn btn-ghost btn-sm', style: 'margin-top:10px', textContent: 'Bỏ cấu hình riêng (dùng mặc định)', onclick: async () => {
        const next = await getSettings(); delete next.pages[scope]; await DB.set(SETTINGS, next); refresh();
      } }) : null,
      scope === 'default' ? h('label', { className: 'row', style: 'gap:8px;margin-top:10px' }, h('input', { type: 'checkbox', checked: !!s.messageButton, onchange: async e => { const next = await getSettings(); next.messageButton = e.target.checked; await DB.set(SETTINGS, next); refresh(); } }),
        'Mặc định thêm nút Gửi tin nhắn cho bài mới lên lịch') : null,
      h('p', { className: 'hint', textContent: 'Giờ đăng chọn ngẫu nhiên trong khung, bước 5 phút; cùng Page cách nhau ≥ 1 giờ, khác Page cách nhau ≥ 15 phút (giống tiện ích).' }));
  }
  function drawDays(s) {
    const next = Array.from({ length: 21 }, (_, d) => Pure.dayKeyOf(Date.now() + d * 864e5));
    const toggle = async day => { const n = await getSettings(); n.days = n.days.includes(day) ? n.days.filter(x => x !== day) : [...n.days, day].sort(); await DB.set(SETTINGS, n); refresh(); };
    $('plDays').replaceChildren(
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Ngày đăng' }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Bỏ chọn', onclick: async () => { const n = await getSettings(); n.days = []; await DB.set(SETTINGS, n); refresh(); } })),
      h('div', { className: 'days' }, ...next.map(day => { const d = new Date(day + 'T00:00'); return h('button', { type: 'button', className: 'chip', 'aria-pressed': String(s.days.includes(day)),
        textContent: `${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, onclick: () => toggle(day) }); })),
      h('p', { className: 'hint', textContent: 'Không chọn ngày nào = xếp trong 14 ngày tới, theo ngày trong tuần của từng Page.' }));
  }
})();
