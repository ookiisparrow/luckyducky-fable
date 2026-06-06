/**
 * 订单样例数据。来源：原型 Checkout.jsx 的 ORDER_CFG / PendingPay。
 * 现为静态样例（无真实订单系统）；以后接后端：用 api/shop.js 按状态拉订单，字段一致。
 *
 * banner 图标用带主题色的变体（package-purple/truck-purple/circle-check-duck）。
 * 金额由商品现算（COUPON/SHIP 与结算一致）。
 */
export const COUPON = 20
export const SHIP = 0

export const ORDER_CFG = {
  toship: {
    title: '待发货',
    icon: 'package-purple',
    tint: 'lilac',
    head: '已付款，等待商家发货',
    sub: '商家将于 48 小时内为你打包发出',
    items: [{ name: '幸运小鸭礼盒 · 零基础钩织套装', spec: '经典暖黄', price: 198, qty: 1 }],
    info: [
      ['订单编号', '2026060514302048'],
      ['付款时间', '2026-06-05 14:31'],
      ['支付方式', '微信支付'],
    ],
    actions: [
      { label: '申请退款', kind: 'ghost', key: 'refund' },
      { label: '提醒发货', kind: 'solid', key: 'remind' },
    ],
  },
  toreceive: {
    title: '待收货',
    icon: 'truck-purple',
    tint: 'lilac',
    head: '商家已发货，包裹运送中',
    sub: '顺丰速运 · 预计明日送达',
    logi: { text: '【杭州转运中心】快件已发出，下一站【上海集散中心】', time: '今天 09:12' },
    items: [{ name: '进阶套装 · 小伙伴们', spec: '4 只装', price: 399, qty: 1 }],
    info: [
      ['订单编号', '2026060212091866'],
      ['付款时间', '2026-06-02 12:09'],
      ['配送方式', '顺丰速运 · 包邮'],
    ],
    actions: [
      { label: '查看物流', kind: 'ghost', key: 'logi' },
      { label: '确认收货', kind: 'solid', key: 'confirm' },
    ],
  },
  done: {
    title: '已完成',
    icon: 'circle-check-duck',
    tint: 'sage',
    head: '交易已完成',
    sub: '期待你钩出的小鸭，欢迎来晒图~',
    items: [{ name: '微笑小鸡 · 入门套装', spec: '鹅黄', price: 128, qty: 1 }],
    info: [
      ['订单编号', '2026052810451233'],
      ['付款时间', '2026-05-28 10:45'],
      ['成交时间', '2026-05-30 16:20'],
    ],
    actions: [
      { label: '再次购买', kind: 'ghost', key: 'rebuy' },
      { label: '评价晒单', kind: 'solid', key: 'review' },
    ],
  },
}

// 待支付样例订单
export const PENDING_ORDER = {
  name: '幸运小鸭礼盒 · 零基础钩织套装',
  spec: '经典暖黄',
  price: 198,
  qty: 1,
  no: '2026060514302048',
  time: '2026-06-05 14:30',
}
