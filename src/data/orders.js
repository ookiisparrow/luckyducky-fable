/**
 * 订单展示配置 + 样例数据。
 * ORDER_STATUS：真实订单 status → 展示配置（列表 / 详情 / 「我」页共用的单一来源）。
 * ORDER_CFG：原型样例（无 id 的 ?status= 演示路径仍在用，P4 真实支付后可删）。
 *
 * banner 图标用带主题色的变体（package-purple/truck-purple/circle-check-duck）。
 * 金额由商品现算（COUPON/SHIP 与结算一致）。
 */
// COUPON/SHIP 单一来源在 data/checkout.js（结算/下单/订单展示共用，避免两处定义漂移）；
// 这里 re-export 让既有 `from '@/data/orders.js'` 的引用方无感。
export { COUPON, SHIP } from './checkout.js'

// 真实订单 status → 展示配置。现阶段 createOrder 模拟支付直接产 paid；
// pending/shipped/done 由 P4 真实支付与 P5 后台流转产生，配置先备齐，
// 状态一出现页面即正确显示。actions 的 key 由订单详情页 onAction 处理。
export const ORDER_STATUS = {
  pending: {
    label: '待支付',
    icon: 'wallet-purple',
    tint: 'lilac',
    head: '等待付款',
    sub: '请尽快完成支付，超时订单将自动关闭',
    actions: [{ label: '去支付', kind: 'solid', key: 'pay' }],
  },
  paid: {
    label: '待发货',
    icon: 'package-purple',
    tint: 'lilac',
    head: '已付款，等待商家发货',
    sub: '商家将于 48 小时内为你打包发出',
    actions: [
      { label: '申请退款', kind: 'ghost', key: 'refund' },
      { label: '提醒发货', kind: 'solid', key: 'remind' },
    ],
  },
  shipped: {
    label: '待收货',
    icon: 'truck-purple',
    tint: 'lilac',
    head: '商家已发货，包裹运送中',
    sub: '收到包裹后记得确认收货',
    actions: [
      { label: '查看物流', kind: 'ghost', key: 'logi' },
      { label: '确认收货', kind: 'solid', key: 'confirm' },
    ],
  },
  done: {
    label: '已完成',
    icon: 'circle-check-duck',
    tint: 'sage',
    head: '交易完成',
    sub: '感谢你的信任，期待小鸭陪你度过快乐时光',
    actions: [
      { label: '再次购买', kind: 'ghost', key: 'rebuy' },
      { label: '评价晒单', kind: 'solid', key: 'review' },
    ],
  },
}

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
