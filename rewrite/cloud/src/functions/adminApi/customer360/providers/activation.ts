import type { CustomerPanelProvider } from '../types'
import { COLLECTIONS } from '@ldrw/shared'

// 激活/课程板块（B1.1 首批 provider·铁律三）：坐席查某客人激活了哪些课、是否进课（bounded）。
// 数据＝activations（activateCourse 写 {_openid, courseId, enteredAt}）；与退款判据 lib.activationFor
// （按 productId 单查）是同集合不同切口（这里按 openid 全量列），单源同一集合、不抽公共件（Rule of Three 未到）。
const LIMIT = 50

export const activationProvider: CustomerPanelProvider = {
  key: 'activation',
  label: '激活/课程',
  enabled: true,
  order: 20,
  async fetch(db: any, openid: string) {
    // 读失败抛给编排器标 PANEL_FETCH_FAIL——空数组会被当成「真没激活过课」
    const r = await db
      .collection(COLLECTIONS.activations)
      .where({ _openid: openid })
      .limit(LIMIT)
      .get()
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
