// Chạy: xvfb-run npx electron test/smoke.js — giả GitHub Pages bằng file trong repo, kiểm tra web + Studio AI trong app.
const { app, session, BrowserWindow } = require('electron'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..'), PREFIX = 'https://vanxharu.github.io/quan-ly-page/';
const type = f => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'text/html';
app.whenReady().then(() => session.defaultSession.protocol.handle('https', req => {
  if (req.url.startsWith(PREFIX)) { let f = path.join(ROOT, decodeURIComponent(new URL(req.url).pathname.replace('/quan-ly-page/', ''))); if (f.endsWith(path.sep) || f === ROOT) f = path.join(f, 'index.html');
    try { return new Response(fs.readFileSync(f), { headers: { 'content-type': type(f) } }); } catch { return new Response('', { status: 404 }); } }
  if (req.url.startsWith('https://business.facebook.com/latest/inbox')) return new Response(fs.readFileSync(path.join(__dirname, 'fixtures/inbox.html')), { headers: { 'content-type': 'text/html' } });
  if (req.url.startsWith('https://business.facebook.com/latest/composer')) return new Response(fs.readFileSync(path.join(__dirname, 'fixtures/composer.html')), { headers: { 'content-type': 'text/html' } });
  if (req.url.startsWith('https://www.facebook.com/')) return new Response('<html><body>fb</body></html>', { headers: { 'content-type': 'text/html' } });
  if (req.url.includes('graph.facebook.com') && req.url.includes('/me/accounts')) return Response.json({ data: [{ id: '1', name: 'Page A', access_token: 't' }] });
  if (req.url.includes('graph.facebook.com')) return Response.json({ data: [] });
  return new Response('', { status: 404 });
}));
const electron = require('electron'), opened = []; electron.shell.openExternal = url => { opened.push(url); return Promise.resolve(); };
try { fs.rmSync(path.join(app.getPath('userData'), 'layout.json')); } catch {}
require('../main.js');
setTimeout(async () => {
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
    out.lookup = await win.webContents.executeJavaScript("metaDesktop.lookupProfile({pageId:'123456',psid:'9',name:'Nguyễn Thảo'})");
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const composing = win.webContents.executeJavaScript(`metaDesktop.composePost({pageId:'123456',text:'Xin chào khách',image:'${png}',when:Math.floor(Date.now()/1000)+3600})`);
    await new Promise(r => setTimeout(r, 9000));
    const meta = app.views.meta.webContents;
    out.composer = await meta.executeJavaScript("[document.getElementById('ed')?.innerText, document.body.dataset.file || '', document.getElementById('js_i3').textContent, document.getElementById('sw').checked]");
    meta.loadURL('https://business.facebook.com/latest/inbox/all?asset_id=123456');
    out.composeResult = await composing;
    app.toggleStudio(true);
    out.hiddenPost = await win.webContents.executeJavaScript(`metaDesktop.composePost({pageId:'123456',text:'Bài đăng ngầm',image:'${png}'})`);
    out.sideAfterHidden = app.views.meta.getBounds().width;
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
  console.log('SMOKE', JSON.stringify(out)); process.exit(out.studio?.startsWith('ok') && out.ext?.length && out.panel && out.token === 'TOK123' && out.meta?.[0].includes('asset_id=1') && out.meta[1] > 0 && out.ver?.startsWith('v') && out.dev === 'dev' && out.lookup?.uid === '100012345678' && /thao-big/.test(out.lookup?.pic) && out.composer[0] === 'Xin chào khách' && /^bai-viet\.png:70$/.test(out.composer[1]) && out.composer[2] === 'Gửi tin nhắn' && out.composer[3] === true && out.composeResult?.done && out.hiddenPost?.done && out.hiddenPost?.hidden && out.sideAfterHidden === 0 && out.loginBtn === '1092800303751533' && out.wider && out.hidden === 0 && out.msgPanel === 0 && out.widths[1] > 0 ? 0 : 1);
}, 6000);
// lookup có nghỉ 1.5–3 s; composer chờ tối đa vài giây
