import { ERR, COLLECTIONS } from '@ldrw/shared'
import { getDb } from './db'
import { err } from './reply'
import { alert } from './observe'
import type { OpenIdCtx } from './gate'

// 频控 / 锁定闸（设计约束#13：认证与写入端点默认限速——门锁再硬也要挡无限次尝试）。
// 按 key 在 rateLimit 集合记 {fails, windowStart, lockedUntil}（失败计数）/{hits, hitWindowStart}
// （调用计数）：滚动窗口内累加，失败达 max → 锁定 lockMs；认证成功 → 清零。
// 并发原子性：计数走乐观并发（CAS 重试）单点收口 bumpWindowed——杜绝「读-改-写」在突发并发下
// 计数偏小、限额/锁定漏过；两系列（fails/hits）字段独立、同 key 不互踩。
// best-effort：写频控库失败/重试耗尽不阻断主流程（口令校验本身仍是硬闸）。
export interface ThrottleOpts {
  max: number
  windowMs: number
  lockMs: number
}

const COLL = COLLECTIONS.rateLimit
const rid = (key: string) => 'rl_' + key
const CAS_RETRIES = 20

async function bumpWindowed(
  key: string,
  countField: string,
  windowField: string,
  windowMs: number,
  onPatch?: (count: number, patch: Record<string, unknown>, now: number) => void,
  fastPathMax?: number
): Promise<number | null> {
  const db = getDb()
  const _ = db.command
  const id = rid(key)
  // 盲快路径（批C·等价性论证，仅调用频控 throttleHit 传 fastPathMax 时启用，throttleFail 的锁定
  // 判定分毫不碰）：不读，直接盲发一次条件更新——命中条件「窗口未过期（windowField 在 windowMs
  // 内）且 countField < fastPathMax」才把 countField 原子 +1（_.inc，非读改写的绝对赋值）。
  // 等价性：条件保证「更新前 count < max」，更新后 count ≤ max，天然落在完整路径「count > max 才算
  // 超限」判定的「未超限」区间——不会多放行一个本该拒的请求。并发下：条件更新在真实云数据库是对单
  // 文档的原子读判即写（同一 doc 的多次更新在存储层天然串行化），任何会让 count 越过 max 的那次增
  // 量，其应用时点的 count 已 ≥ max，条件天然不匹配，不会成功；一旦不匹配（含窗口已过期 / 文档尚
  // 未建档两种情况）即回落下方既有「读+判定+CAS」完整路径，超限拒绝 / 换窗重置 / 首写建档三条既有
  // 语义原样触发、不改一行判定顺序。命中时无需精确返回值（外层只做 count>max 比较），fastPathMax
  // 本身就是满足「未超限」的合法哨兵值。
  if (fastPathMax !== undefined) {
    const now0 = Date.now()
    const patch: Record<string, unknown> = { [countField]: _.inc(1) }
    if (onPatch) onPatch(0, patch, now0) // 仅 throttleHit 走此参，其 onPatch 只写 hitAt、不依赖 count 值
    patch.updatedAt = now0
    const cond: Record<string, unknown> = {
      _id: id,
      [windowField]: _.gt(now0 - windowMs),
      [countField]: _.lt(fastPathMax),
    }
    const r = await db
      .collection(COLL)
      .where(cond)
      .update({ data: patch })
      .catch(() => null)
    if (r && r.stats && r.stats.updated === 1) return fastPathMax
  }
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    const now = Date.now()
    const got = await db
      .collection(COLL)
      .doc(id)
      .get()
      .catch(() => null)
    const rec = got && got.data ? got.data : null
    const within = !!rec && typeof rec[windowField] === 'number' && now - rec[windowField] < windowMs
    const count = (within ? rec![countField] || 0 : 0) + 1
    const patch: Record<string, unknown> = within
      ? { [countField]: count }
      : { [countField]: count, [windowField]: now }
    if (onPatch) onPatch(count, patch, now)
    patch.updatedAt = now // TTL 清理锚：cleanupEvents 按 updatedAt 删过期窗口（不入 CAS cond）
    if (!rec) {
      try {
        await db.createCollection(COLL).catch(() => {})
        await db.collection(COLL).add({ data: { _id: id, createdAt: now, ...patch } })
        return count
      } catch {
        continue // 并发首写撞号 → 重试转 update 路径
      }
    }
    // CAS 前置：窗内连同计数、否则窗口起点须仍是读到的旧值（缺失则 exists(false)——两系列不互踩）
    const cond: Record<string, unknown> = { _id: id }
    if (within) {
      cond[windowField] = rec[windowField]
      cond[countField] = rec[countField] || 0
    } else {
      cond[windowField] = typeof rec[windowField] === 'number' ? rec[windowField] : _.exists(false)
    }
    const r = await db
      .collection(COLL)
      .where(cond)
      .update({ data: patch })
      .catch(() => null)
    if (r && r.stats && r.stats.updated === 1) return count
  }
  // CAS 重试耗尽（课程链路审计 2026-07-17·根因#13/#14）：同 key 高并发争抢下这次计数没写进去——对
  // throttleFail 意味着这次失败尝试等于没发生（爆破者可借洪水稀释计数）。维持 best-effort 放行语义
  // （头注刻意取舍：频控库故障不阻断主流程，口令校验仍是硬闸；改 fail-closed 属安全/可用性权衡，
  // 待用户拍板——见 2026-07-17 课程链路审计报告），但耗尽不再静默：留痕告警可查可统计。
  alert('security', 'throttle', 'CAS_EXHAUSTED', { key })
  return null
}

/** 锁定中？是 → 返回剩余毫秒；否 → 0。调用方据此拒绝。 */
export async function throttleLocked(key: string): Promise<number> {
  const db = getDb()
  const got = await db
    .collection(COLL)
    .doc(rid(key))
    .get()
    .catch(() => null)
  const rec = got && got.data ? got.data : null
  const left = rec && typeof rec.lockedUntil === 'number' ? rec.lockedUntil - Date.now() : 0
  return left > 0 ? left : 0
}

/** 记一次失败：滚动窗口内累加；达 max → 锁定 lockMs 并清零计数 + 爆破告警。 */
export async function throttleFail(key: string, opts: ThrottleOpts): Promise<void> {
  const n = await bumpWindowed(key, 'fails', 'windowStart', opts.windowMs, (count, patch, now) => {
    if (count >= opts.max) {
      patch.fails = 0
      patch.windowStart = now
      patch.lockedUntil = now + opts.lockMs
    }
  })
  if (n !== null && n >= opts.max) alert('security', 'throttle', 'LOCKOUT', { key, lockMs: opts.lockMs })
}

/** 认证成功：清零计数与锁定（仅在有残留时写，常态零开销）。 */
export async function throttleReset(key: string): Promise<void> {
  const db = getDb()
  const got = await db
    .collection(COLL)
    .doc(rid(key))
    .get()
    .catch(() => null)
  const rec = got && got.data ? got.data : null
  if (rec && ((rec.fails || 0) > 0 || (rec.lockedUntil || 0) > 0)) {
    await db
      .collection(COLL)
      .doc(rid(key))
      .update({ data: { fails: 0, lockedUntil: 0 } })
      .catch(() => {})
  }
}

/** 调用频控：每次调用计一次（CAS 原子），滚动窗口内 > max → true（超限，调用方拒）。 */
export async function throttleHit(key: string, opts: { max: number; windowMs: number }): Promise<boolean> {
  const n = await bumpWindowed(
    key,
    'hits',
    'hitWindowStart',
    opts.windowMs,
    (_c, patch, now) => {
      patch.hitAt = now
    },
    opts.max // 启用盲快路径（仅此调用点——throttleFail 的锁定判定不传，语义零改）
  )
  return n !== null && n > opts.max
}

/**
 * 频控装饰器：包住 withOpenId 的 handler，按 (name, openid) 限频；
 * 超频返回 err(RATE_LIMITED)、不执行 handler。用于高频/造数的用户端写函数。
 */
export function withRateLimit(
  name: string,
  opts: { max: number; windowMs: number },
  handler: (ctx: OpenIdCtx) => Promise<any>
) {
  return async (ctx: OpenIdCtx) => {
    const over = await throttleHit('fn:' + name + ':' + ctx.OPENID, opts)
    if (over) return err(ERR.RATE_LIMITED)
    return handler(ctx)
  }
}
