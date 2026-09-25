import { getDb } from './db'

/**
 * 确定性 _id 幂等建档（设计约束#1：确定性主键——撞键＝并发方已写＝天然幂等）。
 * 以传入 id 建档；撞号（并发/重试已建）→ 吞掉、读回，绝不产生第二条。
 * fail-safe 且不掩盖真失败：集合未建则建一次重试；最终以**读回**为准——
 * 读到即返回真档（自建/并发方建都算成），读不到＝写确实没落 → 抛错上抛，不返回假成功。
 */
export async function ensureDoc(coll: string, id: string, data: Record<string, unknown>): Promise<any> {
  const db = getDb()
  const rec = { _id: id, ...data }
  try {
    await db.collection(coll).add({ data: rec })
  } catch {
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
  const got = await db
    .collection(coll)
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data) throw new Error('ENSURE_DOC_FAILED:' + coll + ':' + id)
  return got.data
}
