// Chạy: xvfb-run npx electron test/smoke.js — giả GitHub Pages bằng file trong repo, kiểm tra web + Studio AI trong app.
const { app, session, BrowserWindow } = require('electron'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..'), PREFIX = 'https://vanxharu.github.io/quan-ly-page/';
const type = f => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'text/html';
app.whenReady().then(() => session.defaultSession.protocol.handle('https', req => {
  if (req.url.startsWith(PREFIX)) { let f = path.join(ROOT, decodeURIComponent(new URL(req.url).pathname.replace('/quan-ly-page/', ''))); if (f.endsWith(path.sep) || f === ROOT) f = path.join(f, 'index.html');
    try { return new Response(fs.readFileSync(f), { headers: { 'content-type': type(f) } }); } catch { return new Response('', { status: 404 }); } }
  if (req.url.includes('graph.facebook.com') && req.url.includes('/me/accounts')) return Response.json({ data: [{ id: '1', name: 'Page A', access_token: 't' }] });
  if (req.url.includes('graph.facebook.com')) return Response.json({ data: [] });
  return new Response('', { status: 404 });
}));
require('../main.js');
setTimeout(async () => {
  const win = BrowserWindow.getAllWindows()[0], out = {};
  try {
    out.ua = await win.webContents.executeJavaScript('navigator.userAgent');
    out.ext = (session.defaultSession.extensions || session.defaultSession).getAllExtensions().map(e => e.name + ' ' + e.version);
    await win.webContents.executeJavaScript("localStorage.setItem('fbTok','x'); 1");
    win.webContents.reload(); await new Promise(r => setTimeout(r, 5000));
    out.pages = await win.webContents.executeJavaScript('App.pages.length');
    out.studio = await win.webContents.executeJavaScript('App.ai.getSettings().then(r=>"ok "+r.settings.postPrompt.slice(0,30)).catch(e=>"ERR "+e.message)');
    out.save = await win.webContents.executeJavaScript('App.ai.saveSettings({postPrompt:"Lệnh thử",imagePrompt:"Ảnh thử"}).then(r=>"ok "+r.settings.postPrompt).catch(e=>"ERR "+e.message)');
  } catch (e) { out.error = e.message; }
  console.log('SMOKE', JSON.stringify(out)); process.exit(out.studio?.startsWith('ok') && out.ext?.length ? 0 : 1);
}, 6000);
