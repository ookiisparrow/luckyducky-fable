import type { CustomerPanelProvider } from '../types'

// 订单板块（B1.1 首批 provider·铁律三）：坐席查某客人最近订单（bounded·防大客户拖垮·capacity-reads-bounded）。
// 与 bot 侧 summarizeOrders（cs/dispatch·返文本·限 3）是同数据不同形状的两读者——Rule of Three 未到，
// 暂不抽公共「按 openid 取近单」件（防过度工程·CLAUDE §7·宁先重复）。
const LIMIT = 20

export const ordersProvider: CustomerPanelProvider = {
  key: 'orders',
  label: '订单',
  enabled: true,
  order: 10,
  async fetch(db: any, openid: string) {
    const r = await db
      .collection('orders')
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(LIMIT)
      .get()
      .catch(() => ({ data: [] }))
    const list: any[] = (r && r.data) || []
    return {
      count: list.length,
      capped: list.length >= LIMIT,
      orders: list.map((o: any) => ({
        id: o.id || o._id,
        status: o.status,
        amount: o.amount,
        createdAt: o.createdAt,
        itemCount: Array.isArray(o.items) ? o.items.length : 0,
        trackingNo: (o.shipping && o.shipping.trackingNo) || '',
      })),
    }
  },
}
