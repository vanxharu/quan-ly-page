// Tự động hoá trang Meta Business Suite (đã đăng nhập trong app) cho những việc Graph API bị chặn khi app chưa Live:
//  - lookupProfile: mở hội thoại của khách trong một khung ẩn, đọc ảnh đại diện + UID (link trang cá nhân);
//  - composePost: mở trình soạn bài, điền sẵn nội dung + ảnh (qua debugger), người dùng bật nút Gửi tin nhắn / hẹn giờ rồi bấm Đăng.
// Mỗi lần chỉ làm một việc, có nghỉ giữa các lượt, để giống thao tác người thật.
const fs = require('fs'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isLogin = url => /\/(login|checkpoint)|loginpage|two_step_verification/i.test(url);

// Chạy trong trang Business Suite. Tìm tên khách trên trang (ô hội thoại / đầu khung chat), lấy ảnh gần tên đó;
// UID lấy từ link facebook.com/profile.php?id=… hoặc facebook.com/<số> (bỏ qua Page).
function extractProfile({ pageId, name }) {
  const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const want = norm(name);
  const srcOf = el => el.tagName.toLowerCase() === 'img' ? el.currentSrc || el.src : el.getAttribute('xlink:href') || el.getAttribute('href') || '';
  const isPic = el => /fbcdn|fbsbx|scontent/.test(srcOf(el));
  const size = el => { const r = el.getBoundingClientRect(); return Math.max(r.width, r.height) || Number(el.getAttribute('width')) || 0; };
  let uid = '', profileUrl = '', pic = '';
  for (const a of document.querySelectorAll('a[href]')) {
    const m = a.href.match(/^https:\/\/(?:www\.|m\.)?facebook\.com\/(?:profile\.php\?id=(\d{5,})|(\d{5,}))(?:[/?&#]|$)/);
    const id = m && (m[1] || m[2]);
    if (id && id !== String(pageId)) { uid = id; profileUrl = `https://www.facebook.com/profile.php?id=${id}`; break; }
  }
  if (want) {
    const named = [...document.querySelectorAll('span,div,a,h1,h2,h3,[aria-label],img[alt]')]
      .filter(el => norm(el.getAttribute('aria-label')) === want || norm(el.getAttribute('alt')) === want || (el.childElementCount === 0 && norm(el.textContent) === want));
    let best = null;
    for (const el of named) {
      if (el.tagName.toLowerCase() === 'img' && isPic(el)) { if (!best || size(el) > size(best)) best = el; continue; }
      let box = el;
      for (let i = 0; i < 6 && box; i++, box = box.parentElement) {
        const pics = [...box.querySelectorAll('img,image')].filter(isPic);
        if (pics.length) { for (const p of pics) if (!best || size(p) > size(best)) best = p; break; }
      }
    }
    pic = best ? srcOf(best) : '';
  }
  return { pic, uid, profileUrl, nameSeen: !!want && document.body.innerText.toLowerCase().includes(want) };
}

function createMetaAuto({ worker, metaView, showMeta }) {
  // Hai hàng chờ riêng: đọc avatar (khung ẩn) không phải chờ trình soạn bài (có thể mở lâu).
  const makeQueue = () => { let chain = Promise.resolve(); return fn => (chain = chain.then(fn, fn)); };
  const queue = makeQueue(), composeQueue = makeQueue();

  const lookupProfile = ({ pageId, psid, name }) => queue(async () => {
    if (!/^\d+$/.test(String(pageId)) || !/^\d+$/.test(String(psid))) return { error: 'Thiếu Page hoặc khách.' };
    const wc = worker.webContents;
    const url = `https://business.facebook.com/latest/inbox/all?asset_id=${pageId}&mailbox_id=${pageId}&selected_item_id=${psid}&thread_type=FB_MESSAGE`;
    await wc.loadURL(url).catch(() => {});
    let last = {};
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      if (isLogin(wc.getURL())) return { error: 'login' };
      last = await wc.executeJavaScript(`(${extractProfile})(${JSON.stringify({ pageId: String(pageId), name: String(name || '') })})`).catch(() => ({}));
      if (last.pic && (last.uid || i >= 6)) break;
    }
    await sleep(1500 + Math.random() * 1500); // nghỉ giữa các lượt
    return last.pic || last.uid ? { pic: last.pic || '', uid: last.uid || '', profileUrl: last.profileUrl || '' } : { error: last.nameSeen ? 'no-picture' : 'not-found' };
  });

  // Điền sẵn trình soạn bài Business Suite. Trả về khi người dùng đã đăng/hẹn (trang rời khỏi trình soạn) hoặc sau 15 phút.
  const composePost = ({ pageId, text, image }) => composeQueue(async () => {
    if (!/^\d+$/.test(String(pageId))) return { error: 'Thiếu Page.' };
    const wc = metaView.webContents;
    showMeta();
    await wc.loadURL(`https://business.facebook.com/latest/composer/?asset_id=${pageId}&context_ref=POSTS&ref=meta_assistant`).catch(() => {});
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      await sleep(1000);
      if (isLogin(wc.getURL())) return { error: 'login' };
      ready = await wc.executeJavaScript(`!!document.querySelector('[contenteditable="true"][role="textbox"], [contenteditable="true"]')`).catch(() => false);
    }
    if (!ready) return { error: 'Không thấy ô soạn bài của Business Suite.' };
    const dbg = wc.debugger;
    let file = '';
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      if (image) {
        const m = String(image).match(/^data:image\/(\w+);base64,(.+)$/);
        if (m) {
          file = path.join(os.tmpdir(), `meta-assistant-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
          fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
          const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
          const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"][accept*="image"], input[type="file"]' });
          if (nodeId) await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [file] });
        }
      }
      if (text) {
        await wc.executeJavaScript(`(document.querySelector('[contenteditable="true"][role="textbox"]') || document.querySelector('[contenteditable="true"]')).focus(); true`);
        await sleep(300);
        await dbg.sendCommand('Input.insertText', { text: String(text) });
      }
    } catch (e) { return { error: 'Không điền sẵn được bài: ' + e.message }; }
    finally { try { dbg.detach(); } catch {} }
    // Người dùng tự bật "Gửi tin nhắn", chọn giờ, bấm Đăng/Lên lịch → trang rời trình soạn.
    for (let i = 0; i < 900; i++) {
      await sleep(1000);
      if (wc.isDestroyed() || !/\/composer/.test(wc.getURL())) break;
    }
    if (file) fs.rm(file, () => {});
    return { done: !/\/composer/.test(wc.isDestroyed() ? '' : wc.getURL()) };
  });

  return { lookupProfile, composePost };
}
module.exports = { createMetaAuto, extractProfile };
