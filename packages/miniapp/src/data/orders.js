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
// 订单状态值单源 = shared 生成物（order.spec.ts → ORDER_STATUS·根因#2「调用方用常量」）；
// 本文件的展示映射用 OS.* 计算键派生，状态集随声明走、打错状态名编译/运行即露（守卫 order-status-frontend-via-shared）。
import { ORDER_STATUS as OS } from '@luckyducky/shared'

// 订单 items 安全访问（根因#8 渲染访问点纵深防御）。store 入库已 normalizeOrder 保证
// items 恒为数组，这是渲染侧第二道闸：任何绕过 store 的取数路径 / 旧构建脏单，也绝不让
// 列表 orderQty / 详情 cfgFromOrder 的 o.items.reduce/.map 抛 TypeError → 整页白屏。
// 与 aftersales/review 页的 `items || []` 同约定，单源在此可被测试直接咬住。
export const orderItems = (o) => (Array.isArray(o?.items) ? o.items : [])
// 件数合计（列表「共 N 件」）：脏单降级为 0，绝不抛。
export const orderQty = (o) => orderItems(o).reduce((s, it) => s + it.qty, 0)

// 真实订单 status → 展示配置。PAY_MODE=mock 时 createOrder 直接产 paid；
// =real 时产 pending（去支付 → 支付回调 → paid），超时由云端关单产 closed。
// actions 的 key 由订单详情页 onAction 处理。
export const ORDER_STATUS = {
  [OS.PENDING]: {
    label: '待支付',
    icon: 'wallet-purple',
    tint: 'lilac',
    head: '等待付款',
    sub: '请尽快完成支付，超时订单将自动关闭',
    actions: [{ label: '去支付', kind: 'solid', key: 'pay' }],
  },
  [OS.PAID]: {
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
  [OS.SHIPPED]: {
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
  [OS.DONE]: {
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
  [OS.CLOSED]: {
    label: '已关闭',
    icon: 'clock-orange',
    tint: 'sage',
    head: '订单已关闭',
    sub: '超时未支付，订单已自动关闭；喜欢的话可以重新下单',
    actions: [{ label: '再次购买', kind: 'solid', key: 'rebuy' }],
  },
}
