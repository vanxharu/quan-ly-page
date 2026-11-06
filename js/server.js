/* Nối trang web với máy chủ bot (Supabase): đăng nhập (chủ / nhân viên), trạng thái máy chủ, kết nối Page,
 * và báo Hộp thư tải lại ngay khi máy chủ nhận tin mới (realtime). Bot chạy trên máy chủ kể cả khi trang đóng. */
(() => {
  const URL = 'https://kpzkokyndacmzuvyaxsc.supabase.co';
  const KEY = 'sb_publishable_MWXmQ59hooGPVZEtGaqkIA_XOvzsxlZ'; // khoá công khai, bảng đã bật RLS
  const sb = window.supabase?.createClient(URL, KEY);
  const S = App.server = { sb, user: null, ready: false, livePages: new Set() };
  S.call = async (action, body = {}) => {
    const { data, error } = await sb.functions.invoke('fb-admin', { body: { action, ...body } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return data;
  };
  // Đọc/ghi bảng; lỗi ném ra Error với lời nhắn dễ hiểu.
  S.q = async promise => { const { data, error } = await promise; if (error) throw new Error(error.message); return data; };
  // Ô báo "cần đăng nhập máy chủ" dùng chung cho các tab Tự động.
  S.gate = el => {
    if (S.user) return false;
    el.replaceChildren(h('div', { className: 'card' }, h('h3', { className: 'card-title', textContent: 'Chưa đăng nhập máy chủ bot' }),
      h('p', { className: 'muted', textContent: 'Bot chạy trên máy chủ Supabase. Đăng nhập máy chủ ở Quản lý › Cài đặt rồi quay lại đây.' }),
      h('button', { className: 'btn btn-primary', textContent: 'Mở Cài đặt', onclick: () => App.show('settings') })));
    return true;
  };

  let channel = null, timer = 0;
  if (sb) {
    sb.auth.getSession().then(({ data }) => { S.user = data.session?.user || null; S.ready = true; drawCard(); });
    sb.auth.onAuthStateChange((_e, session) => { S.user = session?.user || null; drawCard(); subscribe(); });
  }

  // Webhook: máy chủ ghi tin mới → Hộp thư tải lại đúng Page đó ngay. Page đã nối webhook (livePages) được quét thưa
  // hơn nhiều, nên tiết kiệm hạn mức Meta. Đọc danh sách Page từ Supabase, không gọi Facebook.
  async function loadLivePages() {
    try { const rows = await S.q(sb.from('pages').select('id')); S.livePages = new Set((rows || []).map(r => String(r.id))); }
    catch { S.livePages = new Set(); }
  }
  function subscribe() {
    if (!S.user) {
      clearTimeout(timer);
      S.livePages = new Set();
      if (channel) { sb.removeChannel(channel); channel = null; }
      return;
    }
    if (channel) return;
    channel = sb.channel('inbox').on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, payload => {
      const pageId = payload.new?.page_id || payload.old?.page_id;
      if (App.inbox?.realtime && payload.new?.psid) return App.inbox.realtime(payload.new);
      if (App.inbox?.changed) return App.inbox.changed(pageId);
      clearTimeout(timer);
      timer = setTimeout(() => { if (App.current() === 'inbox' && App.isSelected(pageId)) App.tabs.inbox.refresh(); }, 800);
    }).subscribe(status => {
      // Chỉ quét thưa khi kênh realtime thật sự hoạt động; mất kết nối thì quay lại chu kỳ thường.
      if (status === 'SUBSCRIBED') loadLivePages(); else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) S.livePages = new Set();
    });
  }

  // ── Thẻ "Máy chủ bot" trong Cài đặt ───────────────────────
  async function drawCard() {
    const box = $('srvCard'); if (!box) return;
    if (!sb) return box.replaceChildren(h('div', { className: 'status err', textContent: 'Không tải được thư viện Supabase.' }));
    if (!S.ready) return box.replaceChildren(empty('Đang kiểm tra phiên máy chủ…'));
    const head = h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: '🤖 Máy chủ bot (Supabase)' }));
    if (!S.user) {
      const form = h('form', { className: 'form-grid' },
        h('label', { className: 'field' }, 'Email', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
        h('label', { className: 'field' }, 'Mật khẩu (≥ 8 ký tự)', h('input', { type: 'password', name: 'password', required: true, minLength: 8, autocomplete: 'current-password' })),
        h('div', { className: 'row field wide' },
          h('button', { className: 'btn btn-primary', textContent: 'Đăng nhập', value: 'in' }),
          h('button', { className: 'btn btn-ghost', textContent: 'Tạo tài khoản chủ (lần đầu)', value: 'up' })));
      const msg = h('div', { className: 'log' });
      form.onsubmit = async e => {
        e.preventDefault(); const f = new FormData(form), mode = e.submitter?.value;
        msg.replaceChildren(h('div', { className: 'status pending', textContent: 'Đang xử lý…' }));
        const cred = { email: String(f.get('email')).trim(), password: String(f.get('password')) };
        const { error, data } = mode === 'up' ? await sb.auth.signUp(cred) : await sb.auth.signInWithPassword(cred);
        if (error) return msg.replaceChildren(h('div', { className: 'status err', textContent: error.message }));
        if (mode === 'up' && !data.session) msg.replaceChildren(h('div', { className: 'status ok', textContent: 'Đã tạo tài khoản. Mở email để xác nhận rồi đăng nhập.' }));
      };
      return box.replaceChildren(head, h('p', { className: 'muted', textContent: 'Bot (trả lời từ khoá, bình luận, kịch bản, menu) chạy trên máy chủ 24/7. Đăng nhập để cấu hình. Nhân viên dùng tài khoản riêng.' }), form, msg);
    }
    const status = h('div', {}, empty('Đang đọc trạng thái máy chủ…'));
    box.replaceChildren(head,
      h('div', { className: 'row' }, h('span', { className: 'muted grow', textContent: `Đã đăng nhập: ${S.user.email}` }),
        h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Đăng xuất máy chủ', onclick: () => sb.auth.signOut() })),
      status);
    try {
      const st = await S.call('status');
      const connectBtn = h('button', { className: 'btn btn-primary', textContent: `Kết nối ${App.selected().length} Page đang chọn với máy chủ`, onclick: async () => {
        if (!App.userToken) return toast('Đăng nhập Facebook lại (nút đăng xuất góc trên) để lấy token mới.');
        connectBtn.disabled = true; connectBtn.textContent = 'Đang kết nối…';
        try {
          const r = await S.call('connect', { userToken: App.userToken, pageIds: App.selected().map(p => p.id) });
          const bad = r.pages.filter(p => !p.ok);
          toast(`Đã kết nối ${r.pages.length - bad.length}/${r.pages.length} Page.` + (bad.length ? ` Lỗi: ${bad[0].name}: ${bad[0].error}` : ''), bad.length ? 10000 : 3000);
        } catch (e) { toast(e.message, 6000); }
        if (channel) loadLivePages();
        drawCard();
      } });
      status.replaceChildren(
        st.secret ? h('div', { className: 'status ok', textContent: '✓ Máy chủ đã có App Secret của ứng dụng Meta.' })
          : h('div', { className: 'status err', textContent: '✗ Máy chủ chưa có FB_APP_SECRET: dán App Secret vào Supabase › Edge Functions › Secrets (xem hướng dẫn).' }),
        h('div', { className: 'pages section-gap' }, ...(st.pages.length ? st.pages.map(p => h('label', { title: p.error || '', style: 'white-space:normal;flex-wrap:wrap' },
          App.avatar(p.name, p.picture, 20), p.name, h('span', { className: 'tag ' + (p.subscribed ? 'tone-green' : 'tone-red'), style: 'margin-left:auto', textContent: p.subscribed ? 'bot đang nhận tin' : 'chưa nhận tin' }),
          p.error ? h('div', { className: 'hint', style: 'width:100%;color:var(--red,#f87171)', textContent: p.error }) : null))
          : [h('span', { className: 'hint', textContent: 'Chưa có Page nào kết nối với máy chủ.' })])),
        h('div', { className: 'row section-gap' }, connectBtn, h('span', { className: 'hint', textContent: 'Lưu token Page dài hạn trên máy chủ và đăng ký nhận tin nhắn, bình luận.' })));
    } catch (e) { status.replaceChildren(h('div', { className: 'status err', textContent: e.message })); }
  }
  App.server.drawCard = drawCard;
})();
