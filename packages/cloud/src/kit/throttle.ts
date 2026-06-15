import { getDb } from './db'
import { err } from './reply'
import type { OpenIdCtx } from './gate'

// 频控 / 锁定闸（根因账本 #13：无频控 → 暴力破解 / 滥用穿透）。
// 按 key 在 rateLimit 集合记 {fails, windowStart, lockedUntil}：滚动窗口内失败累加，
// 达 max → 锁定 lockMs；认证成功 → 清零。认证类公网端点（无 openid 的口令登录）尤需——
// 否则口令可被无限重试爆破。best-effort：写频控库失败不阻断主流程（口令校验本身仍是硬闸）。
export interface ThrottleOpts {
  max: number // 滚动窗口内允许的失败次数
  windowMs: number // 失败计数滚动窗口
  lockMs: number // 触发后的锁定冷却
}

const COLL = 'rateLimit'
const rid = (key: string) => 'rl_' + key

/** 锁定中？是 → 返回剩余毫秒；否 → 0。调用方据此拒绝（429 + retryAfter）。 */
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

/** 记一次失败：滚动窗口内累加；达 max → 锁定 lockMs 并清零计数。 */
export async function throttleFail(key: string, opts: ThrottleOpts): Promise<void> {
  const db = getDb()
  const id = rid(key)
  const now = Date.now()
  const got = await db
    .collection(COLL)
    .doc(id)
    .get()
    .catch(() => null)
  const rec = got && got.data ? got.data : null
  const within = rec && typeof rec.windowStart === 'number' && now - rec.windowStart < opts.windowMs
  const fails = (within ? rec.fails || 0 : 0) + 1
  const patch: Record<string, unknown> = {
    fails,
    windowStart: within ? rec.windowStart : now,
    updatedAt: now,
  }
  if (fails >= opts.max) {
    patch.fails = 0
    patch.windowStart = now
    patch.lockedUntil = now + opts.lockMs
  }
  if (rec) {
    await db
      .collection(COLL)
      .doc(id)
      .update({ data: patch })
      .catch(() => {})
  } else {
    await db.createCollection(COLL).catch(() => {}) // 首写：集合未建则建一次
    await db
      .collection(COLL)
      .add({ data: { _id: id, createdAt: now, ...patch } })
      .catch(() => {})
  }
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

/**
 * 调用频控（根因#13）：每次调用计一次，滚动窗口内 > max → 返回 true（超限，调用方拒）。
 * 与失败计数（throttleFail）分用不同字段（hits/hitWindowStart），同 key 不互踩。
 */
export async function throttleHit(
  key: string,
  opts: { max: number; windowMs: number }
): Promise<boolean> {
  const db = getDb()
  const id = rid(key)
  const now = Date.now()
  const got = await db
    .collection(COLL)
    .doc(id)
    .get()
    .catch(() => null)
  const rec = got && got.data ? got.data : null
  const within =
    rec && typeof rec.hitWindowStart === 'number' && now - rec.hitWindowStart < opts.windowMs
  const hits = (within ? rec.hits || 0 : 0) + 1
  const patch: Record<string, unknown> = {
    hits,
    hitWindowStart: within ? rec.hitWindowStart : now,
    hitAt: now,
  }
  if (rec) {
    await db
      .collection(COLL)
      .doc(id)
      .update({ data: patch })
      .catch(() => {})
  } else {
    await db.createCollection(COLL).catch(() => {})
    await db
      .collection(COLL)
      .add({ data: { _id: id, ...patch } })
      .catch(() => {})
  }
  return hits > opts.max
}

/**
 * 频控装饰器（根因#13）：包住 withOpenId 的 handler，按 (name, openid) 限频；
 * 超频返回 err('RATE_LIMITED')、不执行 handler。用于高频/造数的用户端写函数。
 * 代价：每次调用多一对 get/update——高频函数（trackEvent）上这是为防刷付的开销，可接受。
 */
export function withRateLimit(
  name: string,
  opts: { max: number; windowMs: number },
  handler: (ctx: OpenIdCtx) => Promise<any>
) {
  return async (ctx: OpenIdCtx) => {
    const over = await throttleHit('fn:' + name + ':' + ctx.OPENID, opts)
    if (over) return err('RATE_LIMITED')
    return handler(ctx)
  }
}
