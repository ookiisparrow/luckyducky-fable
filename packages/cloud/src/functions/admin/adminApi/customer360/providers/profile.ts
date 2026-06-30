import type { CustomerPanelProvider } from '../types'

// 画像 rollup 板块（B1.3·铁律三）：坐席看某客人的总消费/单数/激活与进课/最近活跃——从 orders/activations/events
// 派生（各查 bounded·capacity-reads-bounded·防大客户拖垮）。与看板 getDashboard 的全站聚合是不同切口
// （这里按单个 openid·小集合），单源各表、不抽公共件（Rule of Three 未到·CLAUDE §7）。
const ORDER_LIMIT = 200
const ACT_LIMIT = 100
// 已付口径（与 lib.PAID_STATUSES / 看板 GMV 同义·营收只计已付）。orders.amount 存「元」
//（createOrder 经 fenToYuan 入库·与看板 GMV 同口径），故 totalSpent 单位＝元（展示层直接 ￥，不再 /100）。
const PAID = ['paid', 'shipped', 'done']

export const profileProvider: CustomerPanelProvider = {
  key: 'profile',
  label: '画像',
  enabled: true,
  order: 5, // 排最前（概览先于订单/激活明细面板）
  async fetch(db: any, openid: string) {
    const rows = (qy: any) =>
      qy
        .get()
        .then((r: any) => (r && r.data) || [])
        .catch(() => [])
    const [orders, acts, lastEvt] = await Promise.all([
      rows(db.collection('orders').where({ _openid: openid }).limit(ORDER_LIMIT)),
      rows(db.collection('activations').where({ _openid: openid }).limit(ACT_LIMIT)),
      rows(db.collection('events').where({ _openid: openid }).orderBy('createdAt', 'desc').limit(1)),
    ])
    const paid = orders.filter((o: any) => PAID.includes(o.status))
    const totalSpent = paid.reduce((n: number, o: any) => n + (Number(o.amount) || 0), 0) // 元（与 orders.amount 同口径）
    const entered = acts.filter((a: any) => !!a.enteredAt).length
    return {
      orderCount: orders.length,
      ordersCapped: orders.length >= ORDER_LIMIT, // 破上限即标·totalSpent 为「近 N 单」近似（诚实·根因#8）
      paidCount: paid.length,
      totalSpent, // 元
      activatedCount: acts.length,
      enteredCount: entered,
      // 进课率（百分比·已进课 ÷ 已激活）
      enterRate: acts.length ? Math.round((entered / acts.length) * 100) : 0, // structure-ok：百分比非金额换算
      lastActiveAt: (lastEvt[0] && lastEvt[0].createdAt) || null,
    }
  },
}
