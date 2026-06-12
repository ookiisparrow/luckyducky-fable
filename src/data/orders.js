/**
 * 订单展示配置。
 * ORDER_STATUS：真实订单 status → 展示配置（列表 / 详情 / 「我」页共用的单一来源）。
 * （原 ORDER_CFG 样例驱动已随 P4 支付接真删除，技术债 #8 清账。）
 *
 * banner 图标用带主题色的变体（package-purple/truck-purple/circle-check-duck/clock-orange）。
 */
// COUPON/SHIP 单一来源在 data/checkout.js（结算/下单/订单展示共用，避免两处定义漂移）；
// 这里 re-export 让既有 `from '@/data/orders.js'` 的引用方无感。
export { COUPON, SHIP } from './checkout.js'

// 真实订单 status → 展示配置。PAY_MODE=mock 时 createOrder 直接产 paid；
// =real 时产 pending（去支付 → 支付回调 → paid），超时由云端关单产 closed。
// actions 的 key 由订单详情页 onAction 处理。
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
  closed: {
    label: '已关闭',
    icon: 'clock-orange',
    tint: 'sage',
    head: '订单已关闭',
    sub: '超时未支付，订单已自动关闭；喜欢的话可以重新下单',
    actions: [{ label: '再次购买', kind: 'solid', key: 'rebuy' }],
  },
}
