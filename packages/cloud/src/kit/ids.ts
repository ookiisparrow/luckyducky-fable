import { getDb } from './db'

/**
 * 确定性 _id 幂等建档（根因账本 #1：先查后写并发可重复建档 → 确定性 _id 通例化）。
 * 以传入 id 建档；撞号 = 并发/重试已建 → 吞掉、读回，绝不产生第二条。
 * 调用方先用业务键（如 _openid）where 命中老随机 _id 数据时直接返回、不进这里（惰性迁移）；
 * 进这里即按确定性 id 建。
 *
 * fail-safe（对齐 addTo + 不掩盖真失败）：集合未建则建一次重试；最终以**读回**为准——
 * 读到即返回真档（自建 / 并发方建都算成），读不到 = 写确实没落 → 抛错上抛，不返回假成功。
 *
 * 既有消费者：login / updateProfile / trackEvent(progress)（用户域首写）；
 * activateCourse 的 ensureActivation 是同一形态的先驱（本批未回收，避免动正确代码）。
 */
export async function ensureDoc(coll: string, id: string, data: Record<string, unknown>): Promise<any> {
  const db = getDb()
  const rec = { _id: id, ...data }
  try {
    await db.collection(coll).add({ data: rec })
  } catch {
    // 撞号(并发已建) 或 集合未建——后者建集合再试一次；仍撞号即吞（并发方已建）
    try {
      await db.createCollection(coll)
    } catch {
      /* 集合已存在 */
    }
    try {
      await db.collection(coll).add({ data: rec })
    } catch {
      /* 撞号=并发/重试已建 */
    }
  }
  const got = await db.collection(coll).doc(id).get().catch(() => null)
  if (!got || !got.data) throw new Error('ENSURE_DOC_FAILED:' + coll + ':' + id)
  return got.data
}
