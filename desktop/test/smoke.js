// Chạy: xvfb-run npx electron test/smoke.js — giả GitHub Pages bằng file trong repo, kiểm tra web + Studio AI trong app.
const { app, session, BrowserWindow } = require('electron'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..'), PREFIX = 'https://vanxharu.github.io/quan-ly-page/';
fs.rmSync(path.join(app.getPath('appData'), 'Meta Assistant', 'layout.json'), { force: true }); // độ rộng cột lưu từ lần chạy trước làm sai bài thử
const type = f => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'text/html';
const fake = req => {
  if (req.url.startsWith(PREFIX)) { let f = path.join(ROOT, decodeURIComponent(new URL(req.url).pathname.replace('/quan-ly-page/', ''))); if (f.endsWith(path.sep) || f === ROOT) f = path.join(f, 'index.html');
    try { return new Response(fs.readFileSync(f), { headers: { 'content-type': type(f) } }); } catch { return new Response('', { status: 404 }); } }
  if (req.url.startsWith('https://business.facebook.com/latest/inbox')) return new Response(fs.readFileSync(path.join(__dirname, 'fixtures/inbox.html')), { headers: { 'content-type': 'text/html' } });
  if (req.url.startsWith('https://business.facebook.com/latest/composer')) return new Response(fs.readFileSync(path.join(__dirname, 'fixtures/composer.html'), 'utf8').replace('<script>', `<script>window.MODE=${JSON.stringify(globalThis.composerMode || '')};`), { headers: { 'content-type': 'text/html' } });
  // Đã cấp quyền trước đó: hộp thoại đăng nhập chuyển thẳng về kèm token (làm mới token ngầm).
  if (globalThis.grantOAuth && req.url.startsWith('https://www.facebook.com/v25.0/dialog/oauth')) { const u = new URL(req.url); return Response.redirect(`${u.searchParams.get('redirect_uri')}#access_token=FRESH&state=${u.searchParams.get('state')}`, 302); }
  if (req.url.startsWith('https://www.facebook.com/')) return new Response('<html><body>fb</body></html>', { headers: { 'content-type': 'text/html' } });
  if (req.url.includes('graph.facebook.com') && req.url.includes('/me/accounts')) return Response.json({ data: [{ id: '1', name: 'Page A', access_token: 't' }] });
  if (req.url.includes('graph.facebook.com')) return Response.json({ data: [] });
  return new Response('', { status: 404 });
};
// Trang chính (phiên mặc định) và Business Suite (phiên persist:meta) đều dùng dữ liệu giả.
app.whenReady().then(() => { session.defaultSession.protocol.handle('https', fake); session.fromPartition('persist:meta').protocol.handle('https', fake); });
const electron = require('electron'), opened = []; electron.shell.openExternal = url => { opened.push(url); return Promise.resolve(); };
for (const f of ['layout.json', 'lock.json']) try { fs.rmSync(path.join(app.getPath('userData'), f)); } catch {}
require('../main.js');
const whenViews = fn => { const t = setInterval(() => { if (app.views) { clearInterval(t); setTimeout(fn, 4000); } }, 300); };
whenViews(async () => {
  const win = app.views.page, out = {};
  try {
    out.ua = await win.webContents.executeJavaScript('navigator.userAgent');
    out.ext = (session.defaultSession.extensions || session.defaultSession).getAllExtensions().map(e => e.name + ' ' + e.version);
    await win.webContents.executeJavaScript("localStorage.setItem('fbTok','x'); 1");
    win.webContents.reload(); await new Promise(r => setTimeout(r, 5000));
    out.ver = await win.webContents.executeJavaScript("document.querySelector('.pro-tag').textContent + ' | ' + !document.getElementById('btnUpdate').hidden");
    out.dev = await win.webContents.executeJavaScript('metaDesktop.checkUpdate().then(r => r.state)');
    out.pages = await win.webContents.executeJavaScript('App.pages.length');
    out.studio = await win.webContents.executeJavaScript('App.ai.getSettings().then(r=>"ok "+r.settings.postPrompt.slice(0,30)).catch(e=>"ERR "+e.message)');
    out.save = await win.webContents.executeJavaScript('App.ai.saveSettings({postPrompt:"Lệnh thử",imagePrompt:"Ảnh thử"}).then(r=>"ok "+r.settings.postPrompt).catch(e=>"ERR "+e.message)');
    await win.webContents.executeJavaScript("window.open('https://www.facebook.com/v25.0/dialog/oauth?app_id=1062977306762250&client_id=1062977306762250&config_id=99&redirect_uri=x'); 1");
    await new Promise(r => setTimeout(r, 800));
    const metaWc = app.views.meta.webContents, oauth = new URL(metaWc.getURL());
    out.oauth = oauth.searchParams.get('redirect_uri') + ' cfg=' + oauth.searchParams.get('config_id') + ' external=' + opened.length;
    await metaWc.loadURL('https://vanxharu.github.io/quan-ly-page/desktop-login.html#access_token=BAD&state=wrong').catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    await metaWc.loadURL('https://vanxharu.github.io/quan-ly-page/desktop-login.html#access_token=TOK123&state=' + oauth.searchParams.get('state')).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
    out.token = await win.webContents.executeJavaScript("localStorage.getItem('fbTok')");
    await win.webContents.executeJavaScript("metaDesktop.loginFacebook({appId:'1062977306762250',configId:'1092800303751533'}); 1"); await new Promise(r => setTimeout(r, 400));
    out.loginBtn = new URL(metaWc.getURL()).searchParams.get('config_id');
    out.metaBrands = await app.views.meta.webContents.executeJavaScript("(navigator.userAgentData?.brands||[]).map(b=>b.brand).join(',') + ' | ' + navigator.userAgent.includes('Electron')");
    out.threads = await win.webContents.executeJavaScript("metaDesktop.listThreads({pageId:'123456'})");
    out.openThread = await win.webContents.executeJavaScript("metaDesktop.openThread({pageId:'123456',uid:'100099'})");
    globalThis.grantOAuth = true;
    out.refresh = await win.webContents.executeJavaScript("metaDesktop.refreshLogin({appId:'1062977306762250',configId:'1092800303751533'})");
    globalThis.grantOAuth = false;
    out.thread = await win.webContents.executeJavaScript("metaDesktop.readThread({pageId:'123456',uid:'100099'})");
    out.sent = await win.webContents.executeJavaScript("metaDesktop.sendThread({pageId:'123456',uid:'100099',text:'Dạ 150k ạ'})");
    out.sentPic = await win.webContents.executeJavaScript("metaDesktop.sendThread({pageId:'123456',uid:'100099',text:'Mẫu đây ạ',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='})");
    out.lookup = await win.webContents.executeJavaScript("metaDesktop.lookupProfile({pageId:'123456',psid:'9',name:'Nguyễn Thảo'})");
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    // Hẹn giờ: làm ngầm hết (ảnh, chữ, nút, ngày + giờ) rồi tự bấm Lên lịch.
    const at = new Date(Date.now() + 26 * 3600e3); at.setHours(7, 10, 0, 0);
    out.composeResult = await win.webContents.executeJavaScript(`metaDesktop.composePost({pageId:'123456',text:'Xin chào khách',image:'${png}',when:${Math.floor(at / 1000)}})`);
    const meta = app.views.meta.webContents;
    await meta.loadURL('https://business.facebook.com/latest/inbox/all?asset_id=123456');
    out.composer = JSON.parse(await meta.executeJavaScript("localStorage.getItem('lastPost')"));
    out.expectDate = `${at.getDate()} Tháng ${at.getMonth() + 1}, ${at.getFullYear()}`;
    app.toggleStudio(true);
    out.hiddenPost = await win.webContents.executeJavaScript(`metaDesktop.composePost({pageId:'123456',text:'Bài đăng ngầm',image:'${png}'})`);
    // Business Suite chỉ báo "đã lên lịch" / hiện hộp xác nhận / không phản hồi: không được mở cột Meta ngay.
    for (const mode of ['toast', 'dialog', 'stuck']) {
      globalThis.composerMode = mode;
      out['mode_' + mode] = await win.webContents.executeJavaScript(`metaDesktop.composePost({pageId:'123456',text:'Bài ${mode}',image:'${png}',when:${Math.floor((Date.now() + 864e5) / 1000)}})`);
    }
    globalThis.composerMode = '';
    out.sideAfterHidden = app.views.meta.getBounds().width;
    // Khoá app: đặt mật khẩu → khoá → sai → đúng.
    const lk = app.appLock, lv = lk.view.webContents, wait = ms => new Promise(r => setTimeout(r, ms));
    lk.settings(); await wait(1200);
    out.lockSetup = await lv.executeJavaScript("(async()=>{const i=[...document.querySelectorAll('input[type=password]')];i[0].value='1234';i[1].value='1234';document.querySelector('form').requestSubmit();await new Promise(r=>setTimeout(r,500));return JSON.stringify(await lockApi.state())})()");
    lk.lock(); await wait(1200);
    out.lockCover = lk.view.getBounds().width > 0 && lk.isLocked();
    out.lockWrong = await lv.executeJavaScript("lockApi.unlock('0000').then(r=>r.error)");
    out.lockRight = await lv.executeJavaScript("lockApi.unlock('1234').then(r=>r.ok)");
    out.lockGone = lk.view.getBounds().width === 0 && !lk.isLocked();
    // Chuyển sang app khác (cửa sổ mất focus, không cửa sổ nào của app được chọn) → tự khoá; quay lại ngay thì không khoá.
    const { BaseWindow } = require('electron'), main = BaseWindow.getAllWindows().find(w => w.contentView.children.includes(lk.view));
    main.emit('blur'); main.emit('focus'); await wait(1600);
    out.blurBack = lk.isLocked();
    const realFocused = BaseWindow.getFocusedWindow; BaseWindow.getFocusedWindow = () => main; // cửa sổ phụ của app đang được chọn
    main.emit('blur'); await wait(1600); out.blurOwn = lk.isLocked();
    BaseWindow.getFocusedWindow = () => null; // app khác đang ở trên
    main.emit('blur'); await wait(1600); out.blurLock = lk.isLocked();
    out.bgTimers = await win.webContents.executeJavaScript('new Promise(r => { let n = 0; const t = setInterval(() => n++, 100); setTimeout(() => { clearInterval(t); r(n); }, 1100); })'); // vẫn chạy khi đang khoá
    BaseWindow.getFocusedWindow = realFocused;
    await lv.executeJavaScript("lockApi.unlock('1234')");
    out.panelCall = await app.views.panel.webContents.executeJavaScript("new Promise(r=>chrome.runtime.sendMessage({type:'PANEL_STATUS'},x=>r(x&&x.ok!==false&&!x.error)))");
    out.panel = await app.views.panel.webContents.executeJavaScript('document.body.innerText.slice(0,40)');
    await win.webContents.executeJavaScript("metaDesktop.tabChanged('messages'); 1"); await new Promise(r => setTimeout(r, 300));
    out.msgPanel = app.views.panel.getBounds().width;
    await win.webContents.executeJavaScript("metaDesktop.tabChanged('publishing'); 1"); await new Promise(r => setTimeout(r, 300));
    out.widths = [app.views.page.getBounds().width, app.views.panel.getBounds().width];
    app.toggleStudio(); out.closed = app.views.panel.getBounds().width;
    await win.webContents.executeJavaScript("metaDesktop.openMetaInbox('https://evil.example/x'); metaDesktop.openMetaInbox('https://business.facebook.com/latest/inbox/all?asset_id=1&selected_item_id=9'); 1");
    await new Promise(r => setTimeout(r, 800));
    out.meta = [app.views.meta.webContents.getURL(), app.views.meta.getBounds().width, app.views.page.getBounds().width];
    await new Promise(r => setTimeout(r, 800));
    const barWc = app.views.bar.webContents, before = app.views.meta.getBounds().width;
    await barWc.executeJavaScript("bar.cmd('wide'); 1"); await new Promise(r => setTimeout(r, 300));
    out.wider = app.views.meta.getBounds().width > before;
    await barWc.executeJavaScript("bar.cmd('drag-start', 1000); bar.cmd('drag', 900); bar.cmd('drag-end', 900); 1"); await new Promise(r => setTimeout(r, 300));
    out.dragged = app.views.meta.getBounds().width;
    await barWc.executeJavaScript("bar.cmd('close'); 1"); await new Promise(r => setTimeout(r, 300));
    out.hidden = app.views.meta.getBounds().width;
  } catch (e) { out.error = e.message; }
  console.log('SMOKE', JSON.stringify(out)); process.exit(out.mode_toast?.done === true && out.mode_dialog?.done === true && out.mode_stuck?.uncertain === true && out.refresh?.token === 'FRESH' && JSON.stringify(out.thread?.messages) === JSON.stringify([{ sep: 'Hôm nay' }, { mine: false, text: 'Shop ơi còn hàng không' }, { mine: true, text: 'Dạ còn ạ' }, { mine: false, pic: 'https://scontent.xx.fbcdn.net/v/anh-khach.jpg' }, { mine: false, text: 'Giá sao ạ' }]) && out.sent?.done && out.sentPic?.done && out.sentPic.messages.at(-1).pic.endsWith('gui-anh.png.jpg') && out.sentPic.messages.at(-2).text === 'Mẫu đây ạ' && out.sent.messages.at(-1).text === 'Dạ 150k ạ' && out.threads?.rows?.[0]?.snippet === 'Cho mình hỏi giá ạ' && out.threads.rows[0].time === '5 phút' && out.threads.rows[0].unread === true && out.threads.rows[1]?.unread === false && out.threads.rows[1].time === 'Th 3' && out.openThread === true && out.studio?.startsWith('ok') && out.ext?.length && out.panel && out.token === 'TOK123' && out.meta?.[0].includes('asset_id=1') && out.meta[1] > 0 && out.ver?.startsWith('v') && out.dev === 'dev' && out.lookup?.uid === '100012345678' && /thao-big/.test(out.lookup?.pic) && out.composer[0] === 'Lên lịch' && out.composer[1] === 'Xin chào khách' && /^bai-viet\.png:70$/.test(out.composer[2]) && out.composer[3] === 'Gửi tin nhắn' && out.composer[5] === out.expectDate && out.composer[6] === '7' && out.composer[7] === '10' && out.composeResult?.hidden && out.composeResult?.done && out.hiddenPost?.done && out.hiddenPost?.hidden && out.sideAfterHidden === 0 && out.loginBtn === '1092800303751533' && out.lockCover && out.lockWrong === 'Sai mật khẩu.' && out.lockRight && out.lockGone && out.blurBack === false && out.blurOwn === false && out.blurLock && out.bgTimers >= 8 && out.panelCall === true && /Google Chrome/.test(out.metaBrands) && / \| false$/.test(out.metaBrands) && out.wider && out.hidden === 0 && out.msgPanel === 0 && out.widths[1] > 0 ? 0 : 1);
});
// lookup có nghỉ 1.5–3 s; composer chờ tối đa vài giây
