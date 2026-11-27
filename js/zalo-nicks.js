// SPDX-License-Identifier: AGPL-3.0-or-later
/* Quản lý nhiều nick Zalo cá nhân (qua API không chính thức, chỉ trong app Windows): thêm nick bằng QR, xem trạng thái,
 * kéo lịch sử tin riêng + nhóm, đọc nhãn Zalo, gỡ nick. Ý tưởng nhiều nick / QR / lịch sử / nhãn theo ZaloCRM (AGPL-3.0, Nguyễn Tiến Lộc). */
(() => {
  const ST = { ready: '✓ Đang nghe', loading: '⏳ Đang kết nối', paused: '⏸ Tạm ngắt', login: '⚠ Cần quét QR lại', closed: '— Chưa kết nối' };
  let dlg = null, qrBox = null;
  const call = args => window.metaDesktop.zaloNicks(args).catch(e => ({ error: e.message }));
  async function draw() {
    if (!dlg) return;
    const r = await call({}), list = dlg.querySelector('.zn-list');
    list.replaceChildren(...(r.accounts || []).map(a => h('div', { className: 'zn-row' },
      App.avatar(a.name, a.avatar, 32),
      h('div', { className: 'zn-main' }, h('b', { textContent: a.name + (a.web ? ' (Zalo Web)' : '') }),
        h('div', { className: 'hint', textContent: `${ST[a.state] || a.state} · ${a.convs} hội thoại` + (a.err ? ' · ' + a.err : '') })),
      h('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: '⟲ Lịch sử', title: 'Kéo tin riêng cũ + tin 50 nhóm gần nhất', onclick: async e => {
        e.target.disabled = true; toast('Đang kéo lịch sử Zalo của ' + a.name + '… (có thể mất vài phút)');
        const x = await call({ act: 'history', id: a.id }); e.target.disabled = false;
        toast(x.error ? x.error : `Xong: ${x.dm} tin riêng, ${x.groupMsgs} tin từ ${x.groups} nhóm.`, 6000); draw(); } }),
      h('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: '🏷 Nhãn', title: 'Đọc nhãn Zalo của nick này vào nhãn CRM', onclick: async () => {
        const x = await call({ act: 'labels', id: a.id }); toast(x.error ? 'Nhãn Zalo: ' + x.error : `Đã đọc ${x.labels.length} nhãn Zalo: ` + x.labels.map(l => `${l.text} (${l.n})`).join(', '), 6000);
        window.metaDesktop.zaloList?.({}).then(z => z?.rows && App.inbox?.zaloList?.(z.rows)).catch(() => {}); } }),
      h('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Gỡ', onclick: async () => {
        if (!confirm(`Gỡ nick ${a.name} khỏi app? Tin đã lưu của nick này trong app sẽ bị xoá (Zalo không bị ảnh hưởng).`)) return;
        await call({ act: 'remove', id: a.id }); draw(); } }))));
    if (!r.accounts?.length) list.append(h('p', { className: 'hint', textContent: 'Chưa có nick nào chạy qua API. Bấm "＋ Thêm nick" và quét mã bằng app Zalo trên điện thoại.' }));
  }
  function open() {
    if (!window.metaDesktop?.zaloNicks) return toast('Nhiều nick Zalo chỉ có trong app Get Helps cho Windows.');
    dlg?.close();
    qrBox = h('div', { className: 'zn-qr' });
    dlg = h('dialog', { className: 'svc-dialog zn-dialog', onclose: () => { dlg?.remove(); dlg = null; } },
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '💬 Nick Zalo' }),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
      h('p', { className: 'hint', textContent: '⚠ Đọc Zalo cá nhân qua API không chính thức: Zalo có thể khoá nick dùng cách này. Mỗi nick chỉ có một kết nối web: mở Zalo Web của nick đó ở nơi khác là app tạm ngắt, đóng nơi đó là app nghe lại.' }),
      h('div', { className: 'zn-list' }), qrBox,
      h('div', { className: 'row', style: 'gap:8px;justify-content:flex-end;flex-wrap:wrap' },
        h('button', { type: 'button', className: 'btn btn-primary', textContent: '＋ Thêm nick (quét QR)', onclick: async e => {
          e.target.disabled = true; qrBox.replaceChildren(h('p', { className: 'hint', textContent: 'Đang tạo mã QR…' }));
          const x = await call({ act: 'add' }); e.target.disabled = false;
          if (x.error) qrBox.replaceChildren(h('p', { className: 'hint', textContent: '❌ ' + x.error })); else qrBox.replaceChildren();
          draw(); } })));
    document.body.append(dlg); dlg.showModal(); draw();
  }
  // Sự kiện từ app: mã QR, đã quét, hết hạn, thêm xong.
  function event(ev) {
    if (ev.type === 'added') { toast('Đã thêm nick Zalo ' + ev.name + '. Đang kéo lịch sử tin…', 6000); draw(); return; }
    if (!qrBox) return;
    if (ev.type === 'qr') qrBox.replaceChildren(h('img', { src: ev.image, alt: 'Mã QR đăng nhập Zalo', width: 220, height: 220 }),
      h('p', { className: 'hint', textContent: 'Mở Zalo trên điện thoại → biểu tượng quét mã → quét mã này. Mã đổi mới sau khoảng 100 giây.' }));
    else if (ev.type === 'scanned') qrBox.replaceChildren(h('p', { textContent: `📱 ${ev.name || 'Đã quét'}: bấm "Đăng nhập" trên điện thoại để xác nhận.` }));
    else if (ev.type === 'qr-expired') qrBox.prepend(h('p', { className: 'hint', textContent: 'Mã hết hạn, đang tạo mã mới…' }));
    else if (ev.type === 'qr-dead') qrBox.replaceChildren(h('p', { className: 'hint', textContent: 'Mã hết hạn 3 lần. Bấm "＋ Thêm nick" để tạo mã mới.' }));
    else if (ev.type === 'declined') qrBox.replaceChildren(h('p', { className: 'hint', textContent: 'Đã từ chối trên điện thoại.' }));
    else if (ev.type === 'error') qrBox.replaceChildren(h('p', { className: 'hint', textContent: '❌ ' + ev.error }));
  }
  App.zaloNicks = { open, event };
})();
// Giới thiệu & giấy phép (AGPL-3.0 §5/§7b/§13): mã nguồn + ghi công tác giả ZaloCRM.
App.about = () => {
  const a = (href, t) => h('a', { href, target: '_blank', rel: 'noopener', textContent: t });
  const dlg = h('dialog', { className: 'svc-dialog zn-dialog', onclose: () => dlg.remove() },
    h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '📜 Giới thiệu & giấy phép' }),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Đóng', textContent: '×', onclick: () => dlg.close() })),
    h('p', {}, 'Get Helps là phần mềm mã nguồn mở theo ', a('https://www.gnu.org/licenses/agpl-3.0.html', 'GNU AGPL-3.0'), '. Mã nguồn: ', a('https://github.com/vanxharu/quan-ly-page', 'github.com/vanxharu/quan-ly-page'), '.'),
    h('p', {}, 'Phần Zalo cá nhân (nhiều nick, QR, lịch sử, nhãn) dựa trên ', a('https://github.com/locphamnguyen/ZaloCRM', 'ZaloCRM'),
      ' — © 2026 Nguyễn Tiến Lộc (Loc Nguyen) · ', a('https://locnguyendata.com', 'locnguyendata.com'), ' · locnt@locnguyendata.com · AGPL-3.0.'),
    h('p', { className: 'hint' }, 'Thư viện zca-js (MIT). Phần mềm được cung cấp "nguyên trạng", không kèm bảo hành.'));
  document.body.append(dlg); dlg.showModal();
};
