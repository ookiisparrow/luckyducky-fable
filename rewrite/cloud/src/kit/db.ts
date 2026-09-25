import cloud from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'

let inited = false

/**
 * 取数据库句柄；init 只跑一次（设计约束#5：平台原语收口 kit，业务码禁裸 cloud.*）。
 */
export function getDb() {
  if (!inited) {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    inited = true
  }
  return cloud.database()
}

// 集合未建 ≠ 库挂了：集合还没建＝真没有文档（首次写前合法空）；权限/超时仍当读失败。
// isDocMissing 故意不认 COLLECTION_NOT_EXIST（库存钱链：集合没了不能当「无档不限量」），两者分开判。
export function isCollectionMissing(e: unknown): boolean {
  const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : null
  const t = [o && o.message, o && o.errMsg, o && o.errmsg, o && o.code, o && o.errCode, e]
    .map((x) => (x == null ? '' : String(x)))
    .join('\n')
  if (/permission denied|PERMISSION_DENIED|-502003|ECONNRESET|NETWORK_TIMEOUT/i.test(t)) return false
  return /COLLECTION_NOT_EXIST|-502005|collection does not exist/i.test(t)
}

/** 按确定性 _id 整档写：set 被拒就用 add 以同一 _id 建档；add 也失败就抛给调用方，不吞。 */
export const setOrAdd = (coll: any, id: string, data: Record<string, unknown>): Promise<unknown> =>
  coll.doc(id).set({ data }).catch(() => coll.add({ data: { ...data, _id: id } }))

/** 本人对该课已确认进课的激活记录（limit 1）：播放、学习埋点、节点上传共用这道资格闸。读失败照抛，兜底由调用方定。 */
export const enteredActs = (db: any, openid: string, courseId: string): Promise<{ data: any[] }> =>
  db
    .collection(COLLECTIONS.activations)
    .where({ _openid: openid, courseId, enteredAt: db.command.neq(null) })
    .limit(1)
    .get()
