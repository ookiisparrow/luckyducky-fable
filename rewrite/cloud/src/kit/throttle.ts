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
  onPatch?: (count: number, patch: Record<string, unknown>, now: number) => void
): Promise<number | null> {
  const db = getDb()
  const _ = db.command
  const id = rid(key)
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
  const n = await bumpWindowed(key, 'hits', 'hitWindowStart', opts.windowMs, (_c, patch, now) => {
    patch.hitAt = now
  })
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
