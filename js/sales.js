/* Bán hàng (giống sales.js của tiện ích, dùng chung hàm tính Pure.*): nhập/sửa đơn, trạng thái, doanh thu, lời lãi,
 * sản phẩm bán chạy, khách thân thiết (VIP/Thân thiết/Mới, lâu chưa mua lại), xuất CSV. Lưu: shopOrdersV1. */
(() => {
  const STORE = 'shopOrdersV1';
  const PERIODS = [['today', 'Hôm nay'], ['7d', '7 ngày'], ['30d', '30 ngày'], ['month', 'Tháng này'], ['lastmonth', 'Tháng trước'], ['all', 'Tất cả']];
  let period = '30d', statusFilter = '', editing = null, q = '';
  App.tab('sales', {
    mount(el) {
      el.append(
        h('div', { className: 'toolbar' },
          h('div', { className: 'chips', id: 'saPeriod' }),
          h('span', { className: 'grow' }),
          h('button', { className: 'btn btn-primary', onclick: () => { editing = {}; this.refresh(); } }, '+ Đơn mới'),
          h('button', { className: 'btn btn-ghost', textContent: 'Xuất CSV', onclick: () => exportCsv() })),
        h('div', { id: 'saEditor' }),
        h('div', { className: 'kpis', id: 'saKpis' }),
        h('div', { className: 'card' }, h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: 'Doanh thu theo ngày (đơn đã hoàn thành)' })), h('div', { className: 'bars', id: 'saBars' })),
        h('div', { className: 'grid2' },
          h('div', { className: 'card' }, h('h3', { className: 'card-title', textContent: 'Sản phẩm bán chạy' }), h('div', { className: 'scroll', id: 'saTop' })),
          h('div', { className: 'card' }, h('h3', { className: 'card-title', textContent: 'Khách thân thiết' }), h('div', { className: 'scroll', id: 'saLoyal' }))),
        h('div', { className: 'card' },
          h('div', { className: 'toolbar' }, h('h3', { className: 'card-title grow', textContent: 'Đơn hàng' }),
            h('input', { type: 'search', placeholder: '🔍 Tên, SĐT, sản phẩm…', style: 'width:200px', oninput: e => { q = norm(e.target.value); this.refresh(); } }),
            h('select', { style: 'width:auto', onchange: e => { statusFilter = e.target.value; this.refresh(); } }, h('option', { value: '', textContent: 'Mọi trạng thái' }),
              ...Object.entries(Pure.STATUS).map(([k, t]) => h('option', { value: k, textContent: t })))),
          h('div', { className: 'scroll', id: 'saOrders' })));
    },
    async refresh() {
      const orders = await DB.get(STORE, []);
      const [from, to] = Pure.rangeOf(period);
      $('saPeriod').replaceChildren(...PERIODS.map(([k, t]) => h('button', { className: 'chip', textContent: t, 'aria-pressed': String(k === period), onclick: () => { period = k; this.refresh(); } })));
      $('saEditor').replaceChildren(editing ? editor(editing, () => { editing = null; this.refresh(); }) : '');
      const s = Pure.summarize(orders, from, to);
      $('saKpis').replaceChildren(...[['Doanh thu', money(s.revenue)], ['Lợi nhuận', money(s.profit)], ['Biên lợi nhuận', `${Math.round(s.margin * 100)}%`],
        ['Đơn (hoàn thành)', `${s.count} (${s.doneCount})`], ['Giá trị TB/đơn', money(s.avgOrder)], ['Đang chờ thu', money(s.pending)], ['Huỷ / hoàn', `${Math.round(s.cancelRate * 100)}%`]]
        .map(([l, v]) => h('div', { className: 'kpi' }, h('div', { className: 'label', textContent: l }), h('div', { className: 'value', textContent: v }))));
      const series = Pure.series(orders, from, to), peak = Math.max(1, ...series.map(b => b.revenue));
      $('saBars').replaceChildren(...(series.length ? series.map(b => h('div', { className: 'b', style: `height:${Math.max(2, b.revenue / peak * 100)}%`, dataset: { tip: `${b.label}: ${money(b.revenue)} · lời ${money(b.profit)}` } }))
        : [empty('Chưa có đơn hoàn thành trong khoảng này.')]));
      const table = (head, rows) => rows.length ? h('table', {}, h('thead', {}, h('tr', {}, ...head.map((t, i) => h('th', { className: i ? '' : 'left', textContent: t })))),
        h('tbody', {}, ...rows.map(r => h('tr', {}, ...r.map((v, i) => h('td', { className: i ? '' : 'left' }, v)))))) : empty('Chưa có dữ liệu.');
      $('saTop').replaceChildren(table(['Sản phẩm', 'SL', 'Doanh thu', 'Lời'], Pure.topProducts(orders, from, to).map(p => [p.name, num(p.qty), money(p.revenue), money(p.profit)])));
      $('saLoyal').replaceChildren(table(['Khách', 'Hạng', 'Đơn', 'Đã mua', 'Lần cuối'], Pure.loyalCustomers(orders).slice(0, 20).map(c => [
        `${c.name}${c.phone ? ' · ' + c.phone : ''}`, h('span', { className: 'tag tone-' + ({ vip: 'red', loyal: 'amber', new: 'blue' })[c.tier], textContent: c.tierLabel }),
        c.orders, money(c.spent), h('span', { style: c.dormant ? 'color:var(--err-text)' : '', title: c.dormant ? 'Quá 60 ngày chưa mua lại: nên chăm sóc' : '', textContent: fmtShort(c.last) })])));
      const list = orders.filter(o => o.at >= from && o.at < to && (!statusFilter || o.status === statusFilter) &&
        (!q || norm(`${o.customer?.name} ${o.customer?.phone} ${(o.items || []).map(i => i.name).join(' ')} ${o.note}`).includes(q))).sort((a, b) => b.at - a.at);
      $('saOrders').replaceChildren(list.length ? h('table', {},
        h('thead', {}, h('tr', {}, ...['Ngày', 'Khách', 'Sản phẩm', 'Thu', 'Lời', 'Trạng thái', ''].map((t, i) => h('th', { className: [1, 2].includes(i) ? 'left' : '', textContent: t })))),
        h('tbody', {}, ...list.map(o => { const t = Pure.orderTotals(o); return h('tr', {},
          h('td', { textContent: fmtShort(o.at) }), h('td', { className: 'left', textContent: `${o.customer?.name || ''}${o.customer?.phone ? ' · ' + o.customer.phone : ''}` }),
          h('td', { className: 'left', textContent: (o.items || []).map(i => `${i.name} x${i.qty}`).join(', ') }),
          h('td', { textContent: money(t.revenue) }), h('td', { textContent: money(t.profit) }),
          h('td', {}, h('select', { style: 'width:auto;padding:3px 6px;font-size:12px', onchange: async e => { await save({ ...o, status: e.target.value, updatedAt: Date.now() }); this.refresh(); } },
            ...Object.entries(Pure.STATUS).map(([k, v]) => h('option', { value: k, textContent: v, selected: k === o.status })))),
          h('td', {}, h('button', { className: 'btn btn-ghost btn-sm', textContent: 'Sửa', onclick: () => { editing = o; this.refresh(); scrollTo({ top: 0, behavior: 'smooth' }); } }),
            h('button', { className: 'btn btn-danger btn-sm', textContent: 'Xoá', style: 'margin-left:4px', onclick: async () => {
              if (!confirm('Xoá đơn này?')) return; await DB.set(STORE, (await DB.get(STORE, [])).filter(x => x.id !== o.id)); this.refresh();
            } }))); }))) : empty('Không có đơn trong khoảng này.'));
    }
  });
  async function save(order) {
    const all = await DB.get(STORE, []);
    await DB.set(STORE, all.some(o => o.id === order.id) ? all.map(o => o.id === order.id ? order : o) : [...all, order]);
  }
  function editor(o, close) {
    const items = h('div', { style: 'display:grid;gap:6px' });
    const addItem = (i = {}) => items.append(h('div', { className: 'row' },
      h('input', { name: 'iname', className: 'grow', placeholder: 'Sản phẩm', value: i.name || '', required: true }),
      h('input', { name: 'iqty', type: 'number', min: 1, value: i.qty || 1, style: 'width:70px', title: 'Số lượng' }),
      h('input', { name: 'iprice', type: 'number', min: 0, step: 1000, value: i.price ?? '', placeholder: 'Giá bán', style: 'width:110px' }),
      h('input', { name: 'icost', type: 'number', min: 0, step: 1000, value: i.cost ?? '', placeholder: 'Giá vốn', style: 'width:110px' })));
    (o.items?.length ? o.items : [{}]).forEach(addItem);
    const field = (label, name, value, type = 'number') => h('label', { className: 'field' }, label, h('input', { name, type, value: value ?? '', ...(type === 'number' ? { min: 0, step: 1000 } : {}) }));
    return h('form', { className: 'card', onsubmit: async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const names = f.getAll('iname'), qty = f.getAll('iqty'), price = f.getAll('iprice'), cost = f.getAll('icost');
      await save({ ...o, id: o.id || uid('ord'), at: f.get('at') ? new Date(f.get('at')).getTime() : Date.now(), updatedAt: Date.now(), source: o.source || 'manual',
        customer: { ...(o.customer || {}), name: String(f.get('name')).trim(), phone: String(f.get('phone')).trim(), address: String(f.get('address')).trim() },
        items: names.map((n, i) => ({ name: n.trim(), qty: Number(qty[i]) || 1, price: Number(price[i]) || 0, cost: Number(cost[i]) || 0 })).filter(i => i.name),
        discount: Number(f.get('discount')) || 0, shipFee: Number(f.get('shipFee')) || 0, shipCost: Number(f.get('shipCost')) || 0, status: String(f.get('status')), note: String(f.get('note')).trim() });
      toast('Đã lưu đơn.'); close();
    } },
      h('div', { className: 'card-head' }, h('h3', { className: 'card-title', textContent: o.id ? 'Sửa đơn' : 'Đơn mới' })),
      h('div', { className: 'form-grid' }, field('Tên khách', 'name', o.customer?.name, 'text'), field('SĐT', 'phone', o.customer?.phone, 'text'), field('Địa chỉ', 'address', o.customer?.address, 'text'),
        h('label', { className: 'field' }, 'Ngày', h('input', { type: 'datetime-local', name: 'at', value: toLocalInput(o.at || Date.now()) }))),
      h('div', { className: 'section-gap' }, items, h('button', { type: 'button', className: 'btn btn-ghost btn-sm', textContent: '+ Thêm dòng', style: 'margin-top:6px', onclick: () => addItem() })),
      h('div', { className: 'form-grid section-gap' }, field('Giảm giá', 'discount', o.discount), field('Phí ship khách trả', 'shipFee', o.shipFee), field('Ship shop trả', 'shipCost', o.shipCost),
        h('label', { className: 'field' }, 'Trạng thái', h('select', { name: 'status' }, ...Object.entries(Pure.STATUS).map(([k, v]) => h('option', { value: k, textContent: v, selected: k === (o.status || 'new') })))),
        h('label', { className: 'field wide' }, 'Ghi chú', h('input', { type: 'text', name: 'note', value: o.note || '' }))),
      h('div', { className: 'row section-gap' }, h('button', { className: 'btn btn-primary', textContent: 'Lưu đơn' }), h('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Huỷ', onclick: close })));
  }
  async function exportCsv() {
    const orders = await DB.get(STORE, []);
    csvDownload(`don-hang-${Pure.dayKeyOf(Date.now())}.csv`, [['Ngày', 'Khách', 'SĐT', 'Địa chỉ', 'Sản phẩm', 'Doanh thu', 'Chi phí', 'Lời', 'Trạng thái', 'Ghi chú'],
      ...orders.sort((a, b) => b.at - a.at).map(o => { const t = Pure.orderTotals(o); return [fmtTime(o.at), o.customer?.name, o.customer?.phone, o.customer?.address,
        (o.items || []).map(i => `${i.name} x${i.qty}`).join('; '), t.revenue, t.cost, t.profit, Pure.STATUS[o.status] || o.status, o.note]; })]);
  }
})();
