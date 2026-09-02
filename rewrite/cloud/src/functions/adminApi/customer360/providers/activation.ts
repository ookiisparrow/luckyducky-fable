import type { CustomerPanelProvider } from '../types'

// 激活/课程板块（B1.1 首批 provider·铁律三）：坐席查某客人激活了哪些课、是否进课（bounded）。
// 数据＝activations（activateCourse 写 {_openid, courseId, enteredAt}）；客服 360 按人列全部码。
// 退款/订单「已进课」不走这里——那两处绑本单行 enteredQty（activationFor），避免别单进课误标本单。
const LIMIT = 50

export const activationProvider: CustomerPanelProvider = {
  key: 'activation',
  label: '激活/课程',
  enabled: true,
  order: 20,
  async fetch(db: any, openid: string) {
    const r = await db
      .collection('activations')
      .where({ _openid: openid })
      .limit(LIMIT)
      .get()
      .catch(() => ({ data: [] }))
    const list: any[] = (r && r.data) || []
    return {
      count: list.length,
      capped: list.length >= LIMIT,
      activations: list.map((a: any) => ({
        courseId: a.courseId,
        code: a.qrcodeId || a.code || a._id,
        activated: true,
        entered: !!a.enteredAt,
        enteredAt: a.enteredAt || null,
      })),
    }
  },
}
