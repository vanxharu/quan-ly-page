// Chạy TRONG trang ChatGPT (không phải vùng riêng của tiện ích). Khối mã mới của ChatGPT dùng CodeMirror: chỉ vẽ phần đang
// thấy của dòng dài / đoạn dài, nên đọc chữ trên trang sẽ thiếu JSON. Ở đây đọc thẳng toàn bộ nội dung từ trình soạn và ghi vào
// thuộc tính data-ma-full để tiện ích đọc. Dự phòng: khi tiện ích bật data-ma-capture rồi bấm nút Copy của khối mã, nội dung
// copy được giữ vào data-ma-copied thay vì ghi vào clipboard của người dùng.
(() => {
  if (window.__metaAssistantReader) return;
  window.__metaAssistantReader = true;
  const root = document.documentElement;
  root.setAttribute('data-ma-reader', '1'); // để tiện ích biết đoạn đọc đã chạy trong trang
  const capturing = () => root.hasAttribute('data-ma-capture');
  const keep = text => { if (typeof text === 'string' && text) root.setAttribute('data-ma-copied', text.slice(-500000)); };
  const cb = navigator.clipboard;
  if (cb) {
    const writeText = cb.writeText?.bind(cb), write = cb.write?.bind(cb);
    if (writeText) cb.writeText = text => capturing() ? (keep(text), Promise.resolve()) : writeText(text);
    if (write) cb.write = async items => {
      if (!capturing()) return write(items);
      for (const item of items || []) if (item.types?.includes('text/plain')) keep(await (await item.getType('text/plain')).text());
    };
  }
  document.addEventListener('copy', e => { if (!capturing()) return; const t = e.clipboardData?.getData('text/plain'); if (t) keep(t); }, true);
  const viewOf = el => el.cmView?.rootView?.view || el.cmView?.view || el.cmTile?.root?.view || el.cmTile?.view || el.parentElement?.cmView?.rootView?.view || null;
  const dump = () => {
    for (const el of document.querySelectorAll('.cm-content')) {
      let text = '';
      try { text = viewOf(el)?.state?.doc?.toString?.() || ''; } catch {}
      if (text && el.getAttribute('data-ma-full') !== text) el.setAttribute('data-ma-full', text);
      // Chẩn đoán: tên các thuộc tính nội bộ CodeMirror gắn trên phần tử (để biết đổi phiên bản).
      if (!text) el.setAttribute('data-ma-keys', Object.keys(el).filter(k => /^cm|^__react/i.test(k)).join(',').slice(0, 200));
    }
  };
  setInterval(dump, 1000); dump();
})();
