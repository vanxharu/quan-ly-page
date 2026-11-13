// Đọc danh mục dịch vụ từ trang web SMM (vd smm.baostar.net) bằng phiên đăng nhập của cột Dịch vụ.
// API chuẩn không có ghi chú, trạng thái bảo trì, thời gian trung bình; các trang /dich-vu/<nhóm> có đủ trong thuộc tính
// data-* của ô chọn máy chủ (<input name="service" data-rate data-status data-notes …>). Chỉ đọc, không đặt đơn.
'use strict';

const decode = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = decode(m[2]);
  return out;
}

// Một trang nhóm dịch vụ → danh sách dịch vụ (kèm dịch vụ con: like/love/care… của cùng máy chủ).
function parseGroupPage(html, path) {
  const title = decode((html.match(/<h4[^>]*class="[^"]*mb-sm-0[^"]*"[^>]*>([^<]*)/i) || [])[1] || '').trim();
  const slug = path.split('/').pop() || '';
  const platform = slug.split('-')[0] || '';
  const out = [];
  for (const m of html.matchAll(/<input\b[^>]*\bname="service"[^>]*>/gi)) {
    const a = attrs(m[0]);
    const id = a['data-id'] || a.value; if (!id) continue;
    const time = v => (v && v !== '--' ? v : '');
    const base = {
      id: String(id), name: a['data-name'] || a['data-desc'] || '', group: title, platform, path,
      rate: Number(a['data-rate']) || 0, min: Number(a['data-min']) || 0, max: Number(a['data-max']) || 0,
      status: a['data-status'] || '', avgTime: time(a['data-average_time']), startTime: time(a['data-start_time']),
      refill: a['data-refill'] === '1', cancel: a['data-cancel'] === '1', labels: a['data-labels'] || '', notes: a['data-notes'] || '',
    };
    out.push(base);
    let kids = {}; try { kids = JSON.parse(a['data-services-child'] || '{}'); if (typeof kids === 'string') kids = JSON.parse(kids); } catch { kids = {}; }
    for (const k of Object.values(kids || {})) {
      if (!k?.id || String(k.id) === base.id) continue;
      out.push({ ...base, id: String(k.id), name: `${base.name} ${k.name || ''}`.trim(), rate: Number(k.rate) || base.rate, parent: base.id });
    }
  }
  return out;
}

const groupPaths = html => [...new Set([...html.matchAll(/href="(?:https?:\/\/[^"/]+)?(\/dich-vu\/[a-z0-9-]+)(?:\?[^"]*)?"/gi)].map(m => m[1]))];

// fetchText(url) → Promise<string>. Đọc lần lượt (3 trang một lúc) để không dồn tải lên web.
async function readCatalog(origin, fetchText, { onProgress } = {}) {
  const home = await fetchText(origin + '/bang-gia');
  const paths = groupPaths(home);
  if (!paths.length) throw Error('Không thấy danh mục dịch vụ trên ' + origin + '/bang-gia');
  const all = new Map(); let done = 0;
  const queue = [...paths];
  const workers = Array.from({ length: 3 }, async () => {
    for (let p; (p = queue.shift());) {
      try { for (const s of parseGroupPage(await fetchText(origin + p), p)) if (!all.has(s.id) || !s.parent) all.set(s.id, s); } catch { /* bỏ qua nhóm lỗi */ }
      onProgress?.(++done, paths.length);
    }
  });
  await Promise.all(workers);
  return [...all.values()];
}

module.exports = { parseGroupPage, groupPaths, readCatalog, decode };
