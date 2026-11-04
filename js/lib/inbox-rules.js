/* Quy tắc dùng chung cho tab Hộp thư (bảng extension) và báo tin (service worker) — 1.0.29.143.
 * Thuần, không đụng DOM/chrome: đồng hồ chờ trả lời, tự gắn nhãn theo từ khóa, đọc SĐT/địa chỉ/gói từ tin nhắn,
 * cài đặt thông báo (bật/tắt theo Page, giờ yên lặng).
 */
var InboxRules = (() => {
  const SETTINGS_KEY = 'inboxSettingsV1';
  const DEFAULT_RULES = [
    { label: 'Hỏi giá', words: ['giá', 'bao nhiêu', 'bảng giá', 'báo giá', 'nhiêu tiền', 'bn tiền', 'price'] },
    { label: 'Có SĐT', phone: true }
  ];
  const DEFAULTS = { waitMinutes: 30, waitNotify: true, autoTag: true, rules: DEFAULT_RULES,
    quiet: false, quietFrom: '22:00', quietTo: '07:00', mutedPages: [] };
  const withDefaults = s => ({ ...DEFAULTS, ...(s || {}), rules: Array.isArray(s?.rules) && s.rules.length ? s.rules : DEFAULT_RULES,
    mutedPages: Array.isArray(s?.mutedPages) ? s.mutedPages.map(String) : [] });

  const fold = v => String(v || '').toLowerCase().normalize('NFC');
  // Tin cuối là của shop: Business Suite ghi "Bạn: …" / "Bạn đã gửi …" ở dòng xem trước.
  const isUnanswered = preview => !!preview && !/^(bạn|you)(:|\s+đã\s|\s+sent\s)/i.test(String(preview).trim());

  // Số phút từ tin cuối, ước theo chữ thời gian của Business Suite ("20:21", "5 phút", "2 giờ", "Thứ Hai", "26 Tháng 10").
  function waitMinutes(thread, now = new Date()) {
    const t = String(thread?.timeText || '').trim().toLowerCase();
    const hm = t.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) {
      let diff = now.getHours() * 60 + now.getMinutes() - (Number(hm[1]) * 60 + Number(hm[2]));
      if (diff < 0) diff += 1440;
      return diff;
    }
    const rel = t.match(/^(\d+)\s*(phút|p|m|giờ|h|ngày|d|tuần|w)\b/);
    if (rel) return Number(rel[1]) * ({ phút: 1, p: 1, m: 1, giờ: 60, h: 60, ngày: 1440, d: 1440, tuần: 10080, w: 10080 })[rel[2]];
    if (/vừa xong|just now/.test(t)) return 0;
    if (Number.isFinite(thread?.daysAgo)) return thread.daysAgo * 1440;
    return null;
  }
  const formatWait = min => min == null ? '' : min < 1 ? 'vừa nhắn' : min < 60 ? `${Math.round(min)} phút`
    : min < 1440 ? `${Math.floor(min / 60)} giờ` : `${Math.floor(min / 1440)} ngày`;

  const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){9}\b/;
  // Nhãn cần gắn theo lời KHÁCH (không xét tin của shop).
  function detectAutoLabels(messages, rules = DEFAULT_RULES) {
    const said = (messages || []).filter(m => m.isCustomer && m.text).map(m => fold(m.text)).join('\n');
    if (!said) return [];
    return rules.filter(r => (r.phone && PHONE.test(said)) || (r.words || []).some(w => w && said.includes(fold(w)))).map(r => r.label);
  }

  // Gợi ý điền đơn từ lời khách: SĐT, địa chỉ (dòng có từ chỉ địa chỉ), gói (vd "2k follow", "1000 like").
  function parseOrderHints(messages) {
    const lines = (messages || []).filter(m => m.isCustomer && m.text).flatMap(m => String(m.text).split('\n')).map(s => s.trim()).filter(Boolean);
    const phoneLine = [...lines].reverse().find(l => PHONE.test(l));
    const phone = phoneLine ? phoneLine.match(PHONE)[0].replace(/[\s.-]/g, '').replace(/^\+?84/, '0') : '';
    const address = [...lines].reverse().find(l => /(địa chỉ|đ\/c|\bđc\b|số nhà|ngõ|ngách|hẻm|đường|phường|xã|quận|huyện|tp\.?|tỉnh|thành phố)/i.test(l) && l.length >= 8) || '';
    const items = [];
    const unit = '(follow|fl|like|lượt thích|view|lượt xem|mắt|sub|subscriber|share|comment|cmt|tim|member|thành viên)';
    for (const l of lines) {
      for (const m of l.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(k|nghìn|ngàn)?\\s*${unit}`, 'gi'))) {
        const qty = Math.round(Number(m[1].replace(',', '.')) * (m[2] ? 1000 : 1));
        if (qty > 0) items.push({ name: `${qty.toLocaleString('vi-VN')} ${m[3].toLowerCase()}`, qty: 1 });
      }
      // "2k" đứng riêng sau khi shop hỏi số lượng: không đoán loại, chỉ ghi số.
      const bare = l.match(/^(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn)$/i);
      if (bare) items.push({ name: `${Math.round(Number(bare[1].replace(',', '.')) * 1000).toLocaleString('vi-VN')}`, qty: 1 });
    }
    const unique = [...new Map(items.map(i => [i.name, i])).values()].slice(-3);
    return { phone, address: address.replace(/^(địa chỉ|đ\/c|đc)\s*[:：-]?\s*/i, ''), items: unique };
  }

  // Thông báo: Page bị tắt hoặc đang giờ yên lặng thì không báo.
  function inQuietHours(settings, now = new Date()) {
    const s = withDefaults(settings);
    if (!s.quiet) return false;
    const toMin = v => { const [h, m] = String(v || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const cur = now.getHours() * 60 + now.getMinutes(), from = toMin(s.quietFrom), to = toMin(s.quietTo);
    return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
  }
  const notifyAllowed = (settings, pageId, now = new Date()) =>
    !withDefaults(settings).mutedPages.includes(String(pageId)) && !inQuietHours(settings, now);

  return { SETTINGS_KEY, DEFAULTS, DEFAULT_RULES, withDefaults, isUnanswered, waitMinutes, formatWait, detectAutoLabels, parseOrderHints, inQuietHours, notifyAllowed };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = InboxRules;
