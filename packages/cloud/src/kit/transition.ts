import { getDb } from './db'

export interface TransitionResult {
  /** 是否真的发生了流转（当前态 ∈ from 才会）。 */
  moved: boolean
  /** 流转前的单据（不存在则缺省）。供调用方据旧值记日志/算 patch。 */
  doc?: any
}

/**
 * 状态机统一闸（根因账本 #2：散写的手写条件更新 → 一处收口）。
 * 用 where({ _id, status: in(from) }).update 做**原子比较并设置**（DB 层 compare-and-set），
 * 天然幂等：重复调用时当前态已不在 from，updated=0，no-op——根治「副作用不幂等 / 跳级 / 倒退」。
 * patch 可为对象或 (旧 doc) => 对象（需读旧值时，如金额核对）。
 */
export async function transition(
  coll: string,
  id: string,
  from: string[],
  to: string,
  patch?: Record<string, unknown> | ((doc: any) => Record<string, unknown>)
): Promise<TransitionResult> {
  const db = getDb()
  const got = await db
    .collection(coll)
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { moved: false }
  const doc = got.data
  const extra = typeof patch === 'function' ? patch(doc) : patch || {}
  const _ = db.command
  const r = await db
    .collection(coll)
    .where({ _id: id, status: _.in(from) })
    .update({ data: { status: to, ...extra } })
  return { moved: r.stats.updated === 1, doc }
}
