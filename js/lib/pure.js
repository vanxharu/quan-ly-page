/* Phần tính toán thuần chép nguyên từ tiện ích Meta Assistant (sales.js, post-schedule.js, topic-library.js, template-stats.js)
 * để trang web cho kết quả giống hệt tiện ích. Không đụng DOM. */
window.Pure = (() => {
  'use strict';
  const STATUS = { new: 'Mới', shipping: 'Đang giao', done: 'Hoàn thành', returned: 'Hoàn hàng', cancelled: 'Đã hủy' };
  const DAY = 864e5;
  // Hạng khách theo đơn đã hoàn thành.
  const TIERS = [['vip', 'VIP', c => c.orders >= 5 || c.spent >= 5e6], ['loyal', 'Thân thiết', c => c.orders >= 2], ['new', 'Mới', () => true]];
  const DORMANT = 60 * DAY; // quá 60 ngày chưa mua lại → gợi ý chăm sóc

  // ── Phần thuần (có test) ─────────────────────────────────────────────────
  const n = v => Math.max(0, Number(v) || 0);
  // revenue: tiền thực thu; cost: giá vốn + ship shop trả. Hoàn hàng: mất phí ship; Đã hủy: không tính.
  function orderTotals(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const goods = items.reduce((sum, item) => sum + n(item.qty) * n(item.price), 0);
    const goodsCost = items.reduce((sum, item) => sum + n(item.qty) * n(item.cost), 0);
    if (order.status === 'cancelled') return { revenue: 0, cost: 0, profit: 0 };
    if (order.status === 'returned') return { revenue: 0, cost: n(order.shipCost), profit: -n(order.shipCost) };
    const revenue = Math.max(0, goods - n(order.discount)) + n(order.shipFee), cost = goodsCost + n(order.shipCost);
    return { revenue, cost, profit: revenue - cost };
  }
  const counted = order => ['done', 'returned'].includes(order.status); // đã chốt kết quả tiền
  function summarize(orders, from = -Infinity, to = Infinity) {
    const list = orders.filter(order => order.at >= from && order.at < to);
    const done = list.filter(counted).map(orderTotals);
    const revenue = done.reduce((s, t) => s + t.revenue, 0), cost = done.reduce((s, t) => s + t.cost, 0);
    const doneCount = list.filter(order => order.status === 'done').length;
    return {
      count: list.length, doneCount, revenue, cost, profit: revenue - cost,
      margin: revenue ? (revenue - cost) / revenue : 0,
      avgOrder: doneCount ? revenue / doneCount : 0,
      pending: list.filter(order => ['new', 'shipping'].includes(order.status)).reduce((s, o) => s + orderTotals(o).revenue, 0),
      cancelRate: list.length ? list.filter(order => ['cancelled', 'returned'].includes(order.status)).length / list.length : 0
    };
  }
  function rangeOf(period, now = Date.now()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const t = today.getTime(), y = today.getFullYear(), m = today.getMonth();
    switch (period) {
      case 'today': return [t, t + DAY];
      case '7d': return [t - 6 * DAY, t + DAY];
      case '30d': return [t - 29 * DAY, t + DAY];
      case 'month': return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()];
      case 'lastmonth': return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
      default: return [-Infinity, Infinity];
    }
  }
  // Doanh thu + lời theo ngày; tối đa 62 cột, khoảng dài hơn gom theo tháng.
  function series(orders, from, to) {
    const done = orders.filter(order => counted(order) && order.at >= from && order.at < to);
    if (!done.length) return [];
    const start = Number.isFinite(from) ? from : Math.min(...done.map(o => o.at));
    const end = Number.isFinite(to) ? to : Date.now() + 1;
    const byMonth = end - start > 62 * DAY;
    const keyOf = at => { const d = new Date(at); return byMonth ? `${d.getMonth() + 1}/${d.getFullYear()}` : `${d.getDate()}/${d.getMonth() + 1}`; };
    const buckets = new Map();
    for (let d = new Date(start); d.getTime() < end; byMonth ? d.setMonth(d.getMonth() + 1, 1) : d.setDate(d.getDate() + 1)) buckets.set(keyOf(d.getTime()), { label: keyOf(d.getTime()), revenue: 0, profit: 0 });
    for (const order of done) { const b = buckets.get(keyOf(order.at)); if (b) { const t = orderTotals(order); b.revenue += t.revenue; b.profit += t.profit; } }
    return [...buckets.values()];
  }
  function topProducts(orders, from, to, limit = 8) {
    const map = new Map();
    for (const order of orders) {
      if (order.status !== 'done' || order.at < from || order.at >= to) continue;
      for (const item of order.items || []) {
        const name = String(item.name || '').trim(); if (!name) continue;
        const row = map.get(name.toLowerCase()) || { name, qty: 0, revenue: 0, profit: 0 };
        row.qty += n(item.qty); row.revenue += n(item.qty) * n(item.price); row.profit += n(item.qty) * (n(item.price) - n(item.cost));
        map.set(name.toLowerCase(), row);
      }
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  }
  const phoneKey = phone => String(phone || '').replace(/\D/g, '').replace(/^84/, '0');
  const customerKey = c => phoneKey(c?.phone) || String(c?.name || '').trim().toLowerCase();
  function loyalCustomers(orders, now = Date.now()) {
    const map = new Map();
    for (const order of [...orders].sort((a, b) => a.at - b.at)) {
      const key = customerKey(order.customer);
      if (!key || order.status !== 'done') continue;
      const row = map.get(key) || { key, name: '', phone: '', orders: 0, spent: 0, profit: 0, first: order.at, last: 0 };
      const t = orderTotals(order);
      row.name = order.customer.name || row.name; row.phone = order.customer.phone || row.phone; // lấy thông tin mới nhất
      row.orders++; row.spent += t.revenue; row.profit += t.profit; row.last = order.at;
      map.set(key, row);
    }
    return [...map.values()].map(row => {
      const [tier, tierLabel] = TIERS.find(([, , test]) => test(row));
      return { ...row, tier, tierLabel, dormant: now - row.last > DORMANT };
    }).sort((a, b) => b.spent - a.spent);
  }
  // Dữ liệu Meta (1.0.29.118): giai đoạn khách từ Trung tâm khách hàng tiềm năng (pageInsightsV1.pages[*].leads) +
  // trạng thái đơn / nhãn của từng khách đọc ở tab Hộp thư (metaCrmV1).
  const META_STATUSES = ['Đã đặt hàng', 'Đã thanh toán', 'Đã vận chuyển', 'Đã đặt lịch'];
  function metaSummary(crm = {}, insightPages = {}) {
    const pages = new Map();
    const pageRow = (id, name = '', avatar = '') => {
      const row = pages.get(id) || { id, name, avatar, stages: {}, leads: 0, statuses: {}, buyers: 0 };
      row.name = row.name || name; row.avatar = row.avatar || avatar;
      pages.set(id, row); return row;
    };
    for (const p of Object.values(insightPages || {})) {
      const row = pageRow(String(p.assetId || ''), p.name, p.avatar);
      for (const st of p.leads?.stages || []) { row.stages[st.name] = (row.stages[st.name] || 0) + st.count; row.leads += st.count; }
    }
    const statuses = {}, customers = [];
    for (const c of Object.values(crm || {})) {
      const row = pageRow(String(c.pageId || ''), c.pageName);
      const orders = (c.activity || []).filter(a => /đã đặt hàng\./i.test(a.text)).length;
      if (c.orderStatus) { statuses[c.orderStatus] = (statuses[c.orderStatus] || 0) + 1; row.statuses[c.orderStatus] = (row.statuses[c.orderStatus] || 0) + 1; }
      if (c.orderStatus || orders) { row.buyers++; customers.push({ name: c.name, pageId: String(c.pageId || ''), status: c.orderStatus || '', orders, labels: c.labels || [] }); }
    }
    const stages = {};
    for (const row of pages.values()) for (const [k, v] of Object.entries(row.stages)) stages[k] = (stages[k] || 0) + v;
    return { stages, leads: Object.values(stages).reduce((a, b) => a + b, 0), statuses, customers, pages: [...pages.values()].filter(r => r.leads || r.buyers) };
  }
  const csv = rows => '﻿' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

  const DEFAULT_WINDOWS = '07:00–09:00, 11:00–13:00, 19:00–22:00'; // sáng đi làm · nghỉ trưa · tối (đông nhất)
  const MIN_LEAD = 35 * 60e3, MAX_LEAD = 74 * 864e5, STEP = 5 * 60e3, PAGE_GAP = 15 * 60e3;
  const WEEKDAYS = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [0, 'CN']];
  // "07:00–09:00, 11h-13h, 19:30-22" → [[420, 540], [660, 780], [1170, 1320]] (phút trong ngày)
  const parseWindows = text => [...String(text || '').matchAll(/(\d{1,2})(?:[:h.](\d{2})|h)?\s*[-–—]\s*(\d{1,2})(?:[:h.](\d{2})|h)?/g)]
    .map(m => [Number(m[1]) * 60 + Number(m[2] || 0), Number(m[3]) * 60 + Number(m[4] || 0)])
    .filter(([start, end]) => start >= 0 && end <= 1440 && end > start).sort((x, y) => x[0] - y[0]);
  const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const windowsLabel = list => list.map(([start, end]) => `${hhmm(start)}–${hhmm(end)}`).join(', ');
  const dayKeyOf = at => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const roundStep = at => Math.round(at / STEP) * STEP;

  // Với mỗi ngày đã tick và mỗi Page: đủ "số bài/ngày" (trừ bài đã có trong hàng chờ ngày đó), đúng ngày trong tuần của Page.
  // Giờ ngẫu nhiên trong các khung tương tác (mỗi bài một khung khác nhau nếu đủ khung), bước 5 phút;
  // cùng Page cách nhau ≥ 1 giờ, khác Page cách nhau ≥ 15 phút, sau hiện tại ≥ 45 phút.
  function planTimes(pages, days, queue = [], now = Date.now(), rand = Math.random) {
    const live = queue.filter(item => item.status !== 'error');
    const taken = live.map(item => item.at);
    const plan = [];
    const allDays = [...new Set([...days, ...pages.flatMap(({ cfg }) => cfg.days || [])])].sort();
    for (const day of allDays) {
      const [y, m, d] = day.split('-').map(Number);
      const weekday = new Date(y, m - 1, d).getDay();
      for (const { key, cfg } of pages) {
        // Page có ngày riêng: đăng đúng các ngày đã tick cho Page đó. Không có: ngày chung + lọc ngày trong tuần.
        const allowed = cfg.days?.length ? cfg.days.includes(day) : days.includes(day) && cfg.weekdays.includes(weekday);
        if (!allowed || !cfg.windows.length) continue;
        const mine = live.filter(item => item.pageKey === key && dayKeyOf(item.at) === day).map(item => item.at);
        const order = [...cfg.windows].sort(() => rand() - 0.5);
        for (let n = 0, need = cfg.perDay - mine.length; n < need; n++) {
          const [start, end] = order[n % order.length];
          let at = 0;
          for (let tries = 0; tries < 40 && !at; tries++) {
            const candidate = new Date(y, m - 1, d, 0, start + 5 * Math.floor(rand() * (Math.floor((end - start) / 5) + 1))).getTime();
            if (candidate < now + MIN_LEAD + 10 * 60e3 || mine.some(t => Math.abs(t - candidate) < 3600e3) ||
              taken.some(t => Math.abs(t - candidate) < PAGE_GAP)) continue;
            at = candidate;
          }
          if (at) { mine.push(at); taken.push(at); }
          plan.push({ key, day, at });
        }
      }
    }
    return plan;
  }


  const DEFAULT_TOPICS = [
    {
      id: 'monday-insight', day: 1, dayLabel: 'Thứ Hai', time: '20:00',
      title: 'Xu hướng & vấn đề marketing thường gặp',
      style: 'Chuyên gia gần gũi, mở đầu bằng vấn đề thực tế',
      direction: 'Giúp khách hàng Việt Nam nhận ra một vấn đề marketing hoặc tăng tương tác đang gặp và hiểu hướng xử lý.',
      postPrompt: 'Viết một bài Facebook hoàn chỉnh về một xu hướng hoặc vấn đề marketing thường gặp tại Việt Nam. Mở đầu bằng tình huống quen thuộc, phân tích ngắn gọn nguyên nhân, đưa ra 3 gợi ý có thể áp dụng ngay và kết thúc bằng một câu hỏi tự nhiên. Không bịa số liệu, không bán hàng trực diện, không giải thích cách bạn viết bài.',
      imagePrompt: 'Tạo ảnh minh họa hiện đại về việc nhận diện vấn đề marketing và tìm hướng đi rõ ràng, bối cảnh doanh nghiệp Việt Nam, bố cục sạch, màu sắc chuyên nghiệp.',
      groupPrompt: 'Mình chia sẻ một góc nhìn ngắn về vấn đề marketing nhiều người bán hàng đang gặp. Anh/chị trong nhóm có thể tham khảo và cùng trao đổi cách xử lý phù hợp với thị trường Việt Nam.'
    },
    {
      id: 'tuesday-checklist', day: 2, dayLabel: 'Thứ Ba', time: '08:00',
      title: 'Mẹo nhanh & checklist tăng tương tác',
      style: 'Ngắn gọn, dễ quét, thực hành ngay',
      direction: 'Cung cấp checklist nhỏ giúp người làm nội dung tối ưu tương tác trên Facebook, TikTok, Instagram hoặc YouTube.',
      postPrompt: 'Viết một bài Facebook dạng checklist ngắn dành cho khách hàng Việt Nam, gồm 5 bước giúp cải thiện nội dung hoặc tăng tương tác mạng xã hội. Mỗi bước phải cụ thể, dễ làm ngay, tránh cam kết kết quả tuyệt đối. Kết bài bằng lời mời lưu bài hoặc chia sẻ kinh nghiệm, không bán hàng trực diện.',
      imagePrompt: 'Tạo ảnh minh họa checklist marketing mạng xã hội trực quan, tối giản, các biểu tượng dễ hiểu, phù hợp người xem Việt Nam.',
      groupPrompt: 'Gửi mọi người một checklist ngắn có thể áp dụng ngay khi làm nội dung mạng xã hội. Mọi người thử đối chiếu xem mình đang thiếu bước nào nhé.'
    },
    {
      id: 'wednesday-guide', day: 3, dayLabel: 'Thứ Tư', time: '08:30',
      title: 'Hướng dẫn chuyên môn từng bước',
      style: 'Có chiều sâu, rõ cấu trúc, dễ hiểu',
      direction: 'Hướng dẫn chi tiết một kỹ năng marketing hoặc vận hành nội dung đa nền tảng cho người Việt.',
      postPrompt: 'Viết một bài hướng dẫn chuyên môn có cấu trúc rõ ràng về một kỹ năng marketing hoặc tăng tương tác mạng xã hội. Giải thích mục tiêu, quy trình từng bước, lỗi cần tránh và cách tự kiểm tra. Dùng ví dụ phù hợp thị trường Việt Nam; không bịa dữ liệu và không chào bán dịch vụ nếu không cần thiết.',
      imagePrompt: 'Tạo ảnh minh họa quy trình marketing từng bước, phong cách chuyên nghiệp, trực quan, có chiều sâu nhưng không rối mắt.',
      groupPrompt: 'Mình chia sẻ hướng dẫn từng bước để mọi người dễ áp dụng vào công việc thực tế. Nội dung hơi chi tiết nhưng có thể lưu lại làm tài liệu tham khảo.'
    },
    {
      id: 'thursday-case', day: 4, dayLabel: 'Thứ Năm', time: '15:30',
      title: 'Case study & giải pháp dịch vụ',
      style: 'Kể chuyện có bằng chứng, thuyết phục mềm',
      direction: 'Phân tích một tình huống khách hàng hoặc bài học thực tế; chỉ giới thiệu dịch vụ tự nhiên khi phù hợp.',
      postPrompt: 'Viết một bài Facebook theo dạng case study marketing dành cho người xem Việt Nam. Nêu bối cảnh, vấn đề, cách tiếp cận, bài học rút ra và gợi ý áp dụng. Chỉ dùng dữ kiện được cung cấp; nếu thiếu số liệu thì mô tả định tính, tuyệt đối không tự bịa kết quả. Có thể giới thiệu dịch vụ nhẹ nhàng ở cuối bài, không cam kết tuyệt đối.',
      imagePrompt: 'Tạo ảnh minh họa case study marketing theo bố cục trước và sau hoặc vấn đề và giải pháp, chuyên nghiệp, đáng tin cậy, không dùng số liệu giả.',
      groupPrompt: 'Mình chia sẻ một tình huống thực tế và cách tiếp cận để mọi người tham khảo. Phần quan trọng nhất là bài học có thể áp dụng, không phải quảng cáo dịch vụ.'
    },
    {
      id: 'friday-tools', day: 5, dayLabel: 'Thứ Sáu', time: '08:00',
      title: 'Công cụ & tài nguyên hữu ích',
      style: 'Tổng hợp khách quan, thực tế, tiết kiệm thời gian',
      direction: 'Giới thiệu công cụ, mẫu hoặc tài nguyên hỗ trợ làm nội dung và quản lý mạng xã hội hiệu quả hơn.',
      postPrompt: 'Viết một bài tổng hợp công cụ hoặc tài nguyên hữu ích cho người làm marketing và mạng xã hội tại Việt Nam. Với mỗi mục, nêu công dụng, trường hợp nên dùng và một lưu ý. Không khẳng định tính năng chưa kiểm chứng, không biến bài thành quảng cáo, kết thúc bằng câu hỏi về công cụ người đọc đang dùng.',
      imagePrompt: 'Tạo ảnh minh họa bộ công cụ marketing và quản lý mạng xã hội, giao diện khái quát không sao chép thương hiệu, bố cục gọn gàng và hữu ích.',
      groupPrompt: 'Mình tổng hợp một số công cụ và tài nguyên hữu ích để mọi người tiết kiệm thời gian làm nội dung. Ai có công cụ hay khác có thể bổ sung thêm cho nhóm nhé.'
    },
    {
      id: 'saturday-brand', day: 6, dayLabel: 'Thứ Bảy', time: '10:00',
      title: 'Hậu trường & câu chuyện thương hiệu',
      style: 'Đời thường, chân thật, ấm áp',
      direction: 'Xây dựng sự tin tưởng bằng câu chuyện con người, quy trình làm việc hoặc bài học phía sau thương hiệu.',
      postPrompt: 'Viết một bài nhẹ nhàng về hậu trường, con người hoặc câu chuyện thương hiệu trong lĩnh vực marketing và tăng tương tác mạng xã hội. Giọng chân thật, gần gũi với người Việt, có một chi tiết đời thường và một bài học nhỏ. Không tô vẽ thành tích, không bán hàng trực diện.',
      imagePrompt: 'Tạo ảnh hậu trường chân thật về đội ngũ làm nội dung và marketing, ánh sáng tự nhiên, cảm giác gần gũi, không dàn dựng quá mức.',
      groupPrompt: 'Cuối tuần mình chia sẻ một câu chuyện hậu trường nhỏ phía sau công việc làm nội dung. Hy vọng góc nhìn thật này giúp mọi người hiểu thêm về quá trình phía sau mỗi bài đăng.'
    },
    {
      id: 'sunday-community', day: 0, dayLabel: 'Chủ Nhật', time: '09:30',
      title: 'Câu hỏi tương tác & kế hoạch tuần mới',
      style: 'Thân thiện, đối thoại, khuyến khích chia sẻ',
      direction: 'Tạo cuộc trò chuyện với cộng đồng và giúp người theo dõi xác định ưu tiên marketing cho tuần mới.',
      postPrompt: 'Viết một bài Facebook nhẹ cho sáng Chủ Nhật, đặt một câu hỏi cụ thể về kế hoạch marketing hoặc mục tiêu tăng tương tác trong tuần mới. Gợi ý 3 lựa chọn để người đọc dễ phản hồi và thêm một bước chuẩn bị nhỏ. Giọng thân thiện với khách hàng Việt Nam, không bán hàng và không dùng câu hỏi chung chung.',
      imagePrompt: 'Tạo ảnh minh họa lập kế hoạch nội dung cho tuần mới, không khí sáng Chủ Nhật tích cực, tối giản, gần gũi người dùng Việt Nam.',
      groupPrompt: 'Chủ Nhật mình xin mở một câu hỏi nhỏ: tuần tới mọi người ưu tiên nội dung, tương tác hay tối ưu quy trình? Cùng chia sẻ để tham khảo thêm ý tưởng từ nhau nhé.'
    }
  ];

  const CONVERTED = /đã chuyển đổi/i;

  // Thuần: gộp lượt gửi + khách chuyển đổi cho từng mẫu, sắp theo lượt gửi.
  function summarize_tpl(stats, crm) {
    const converted = key => { const c = crm?.[key]; return !!c && (CONVERTED.test(c.stage || '') || (c.labels || []).some(l => CONVERTED.test(l))); };
    return Object.entries(stats || {}).map(([id, s]) => {
      const customers = s.customers || [];
      const won = customers.filter(converted).length;
      return { id, title: s.title || 'Mẫu tin', sent: s.sent || 0, customers: customers.length, won, rate: customers.length ? Math.round(won / customers.length * 100) : 0, lastAt: s.lastAt || 0 };
    }).sort((a, b) => b.sent - a.sent || b.won - a.won);
  }
  return { STATUS, orderTotals, summarize, rangeOf, series, topProducts, loyalCustomers, customerKey, phoneKey, csv,
    DEFAULT_WINDOWS, WEEKDAYS, MIN_LEAD, parseWindows, windowsLabel, hhmm, dayKeyOf, planTimes, DEFAULT_TOPICS, summarizeTemplates: summarize_tpl };
})();
