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
  const SEND = { fast: '⚡ Gửi nhanh', ready: '✓ Sẵn sàng', loading: '⏳ Đang mở', none: '— Chưa mở', idle: '💤 Nghỉ' };
  let timer = 0;
  async function tick() {
    clearTimeout(timer);
    const logged = !document.getElementById('btnLogout')?.hidden && App.selected?.().length;
    if (!logged) { btn.hidden = true; timer = setTimeout(tick, 3000); return; }
    let list = []; try { list = await window.metaDesktop.hiddenStatus(); } catch {}
    let z = null; try { z = await window.metaDesktop.zaloStatus?.(); } catch {}
    const zKept = (App.inbox?.zaloCount?.() ?? 0);
    const ZST = { ready: '✓ Đã mở', loading: '⏳ Đang mở', login: '⚠ Chưa đăng nhập', closed: '— Chưa mở' };
    const by = new Map(list.map(x => [String(x.page), x])), pages = App.selected();
    const rows = pages.map(p => ({ p, st: by.get(String(p.id)) || { read: 'none', send: 'none' } }));
    const sendOk = r => r.st.send !== 'loading'; // khung gửi nghỉ / chưa mở vẫn ổn: tin chữ đi qua khung đọc
    for (const r of rows) if (r.st.send !== 'fast' && r.st.readFast) r.st = { ...r.st, send: r.st.send === 'loading' ? 'loading' : 'fast' };
    // Đếm cả khung Zalo (nếu có) vào tổng số khung ngầm.
    const zOk = z?.state === 'ready', zN = z ? 1 : 0;
    const ready = rows.filter(r => r.st.read === 'ready' && sendOk(r)).length + (zOk ? 1 : 0), fast = rows.filter(r => r.st.send === 'fast').length, n = rows.length + zN;
    const state = ready < n ? 'loading' : fast === rows.length ? 'fast' : 'ready';
    btn.hidden = false; btn.className = 'bg-status ' + state;
    btn.replaceChildren(h('span', { className: 'dot' }), state === 'loading' ? `Đang mở khung ngầm ${ready}/${n}` : state === 'fast' ? 'Sẵn sàng · gửi nhanh' : `Sẵn sàng ${ready}/${n}`);
    btn.title = 'Khung ngầm Business Suite + Zalo: bấm để xem từng khung';
    pop.replaceChildren(h('div', { className: 'bg-status-head', textContent: `Khung ngầm (${n}): ${rows.length} Page Business Suite` + (zN ? ' + Zalo' : '') }),
      ...rows.map(({ p, st }) => h('div', { className: 'bg-status-row' }, App.avatar(p.name, App.pageAvatarUrl(p), 20), h('span', { className: 'nm', textContent: p.name }),
        h('span', { className: 'st ' + st.read, title: 'Khung đọc: danh sách, tin mới', textContent: 'Đọc ' + READ[st.read] }),
        h('span', { className: 'st ' + st.send, title: 'Khung gửi: ⚡ = gửi thẳng tin chữ (< 1 giây) · 💤 = khung gửi ảnh chỉ mở khi bạn trả lời Page này, tự đóng sau 5 phút', textContent: SEND[st.send] }))),
      z ? h('div', { className: 'bg-status-row' }, h('img', { src: 'img/platforms/zalo.png', alt: '', style: 'width:20px;height:20px;border-radius:5px' }), h('span', { className: 'nm', textContent: 'Zalo cá nhân' }),
        h('span', { className: 'st ' + (z.state === 'ready' ? 'ready' : z.state === 'loading' ? 'loading' : 'none'), title: z.err || '', textContent: ZST[z.state] || z.state }),
        h('span', { className: 'st ' + (zKept ? 'ready' : 'none'), title: `Đọc được ${z.rows} hội thoại trên Zalo Web · ${zKept} khách hiện trong Hộp thư` + (z.err ? ' · lỗi: ' + z.err : ''), textContent: z.state === 'ready' ? `${zKept} khách` : '' })) : null,
      h('p', { className: 'hint', textContent: 'Mở xong cả hai khung thì bấm vào khách là gửi được ngay. ⚡ Gửi nhanh: tin chữ đi thẳng qua kết nối Meta.' }));
    timer = setTimeout(tick, state === 'fast' ? 10e3 : 2000);
  }
  App.onLogin?.push?.(() => setTimeout(tick, 500));
  setTimeout(tick, 1500);
})();
