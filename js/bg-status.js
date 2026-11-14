/* Thanh trên cùng: trạng thái các khung ngầm Business Suite (app Windows) để biết khi nào app sẵn sàng đọc / gửi tin.
 * Mỗi Page: khung ĐỌC (danh sách, tin mới) + khung GỬI (mở sẵn hội thoại, gửi thẳng tin chữ khi đã bám được kết nối Meta). */
(() => {
  if (!window.metaDesktop?.hiddenStatus) return;
  const btn = h('button', { type: 'button', className: 'bg-status', id: 'bgStatus', hidden: true, 'aria-haspopup': 'true' });
  const pop = h('div', { className: 'bg-status-pop', hidden: true });
  const wrap = h('div', { className: 'bg-status-wrap' }, btn, pop);
  document.getElementById('btnLogout')?.after(wrap);
  btn.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; };
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) pop.hidden = true; });
  const READ = { ready: '✓ Đã mở', loading: '⏳ Đang mở', none: '— Chưa mở' };
  const SEND = { fast: '⚡ Gửi nhanh', ready: '✓ Sẵn sàng', loading: '⏳ Đang mở', none: '— Chưa mở' };
  let timer = 0;
  async function tick() {
    clearTimeout(timer);
    const logged = !document.getElementById('btnLogout')?.hidden && App.selected?.().length;
    if (!logged) { btn.hidden = true; timer = setTimeout(tick, 3000); return; }
    let list = []; try { list = await window.metaDesktop.hiddenStatus(); } catch {}
    const by = new Map(list.map(x => [String(x.page), x])), pages = App.selected();
    const rows = pages.map(p => ({ p, st: by.get(String(p.id)) || { read: 'none', send: 'none' } }));
    const sendOk = r => r.st.send === 'fast' || r.st.send === 'ready' || (r.st.send === 'none' && r.st.read === 'ready' && !list.some(x => x.send !== 'none'));
    const ready = rows.filter(r => r.st.read === 'ready' && sendOk(r)).length, fast = rows.filter(r => r.st.send === 'fast').length, n = rows.length;
    const state = ready < n ? 'loading' : fast === n ? 'fast' : 'ready';
    btn.hidden = false; btn.className = 'bg-status ' + state;
    btn.replaceChildren(h('span', { className: 'dot' }), state === 'loading' ? `Đang mở khung ngầm ${ready}/${n}` : state === 'fast' ? 'Sẵn sàng · gửi nhanh' : `Sẵn sàng ${ready}/${n}`);
    btn.title = 'Khung ngầm Business Suite: bấm để xem từng Page';
    pop.replaceChildren(h('div', { className: 'bg-status-head', textContent: 'Khung ngầm Business Suite' }),
      ...rows.map(({ p, st }) => h('div', { className: 'bg-status-row' }, App.avatar(p.name, App.pageAvatarUrl(p), 20), h('span', { className: 'nm', textContent: p.name }),
        h('span', { className: 'st ' + st.read, title: 'Khung đọc: danh sách, tin mới', textContent: 'Đọc ' + READ[st.read] }),
        h('span', { className: 'st ' + st.send, title: 'Khung gửi: ⚡ = gửi thẳng tin chữ (< 1 giây)', textContent: SEND[st.send] }))),
      h('p', { className: 'hint', textContent: 'Mở xong cả hai khung thì bấm vào khách là gửi được ngay. ⚡ Gửi nhanh: tin chữ đi thẳng qua kết nối Meta.' }));
    timer = setTimeout(tick, state === 'fast' ? 10e3 : 2000);
  }
  App.onLogin?.push?.(() => setTimeout(tick, 500));
  setTimeout(tick, 1500);
})();
