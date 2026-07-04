import cloud from 'wx-server-sdk'
import { getDb, throttleLocked, throttleFail, throttleReset, recordAudit, shouldAudit } from '../../kit'
import { reply, ensure, checkKey, issueSession, type Ctx } from './lib'

// 管理控制台后端 v2（HTTP 访问服务触发·鉴权外壳逐字承接旧线 index.ts·批11 只挂 ping/login，
// 业务 action 后续批逐域挂进 ACTIONS/ACTION_CAPS——挂载时与旧线注册表逐行核对）。
// 鉴权：口令（adminConfig sha256·首登 bootstrap 须部署密钥）→ 会话令牌 fallback；RBAC 能力位默认拒；
// 认证频控 per-IP + 全局兜底。M5 切换日以新名部署、admin 前端切 endpoint。
const db = getDb()

// action → handler 查表（业务批逐域填充）
const ACTIONS: Record<string, (ctx: Ctx) => Promise<any>> = {}

// 能力闸（RBAC·别让单超管裸奔）：受限 action 须 principal 具备对应能力（'*'=全能力）。
// 坐席台/360 读的 cap 随对应域批次登记（与 action 同批落·不空守）。
const ACTION_CAPS: Record<string, string> = {}
// 默认拒：未登记 ACTION_CAPS 的 action 须此高权默认 cap——非超管默认进不去钱/状态/管理 action。
const ADMIN_DEFAULT_CAP = 'admin:write'

// 认证频控（设计约束#13 防爆破）：失败 5 次/10 分 → 锁 5 分；login 与其余 action 的口令校验共用此闸。
const ADMIN_THROTTLE = { max: 5, windowMs: 10 * 60_000, lockMs: 5 * 60_000 }
// 全局失败计数兜底：x-forwarded-for 可伪造轮换让 per-IP 永不达阈——跨所有 IP 累计达此阈仍锁。
const ADMIN_THROTTLE_GLOBAL = { max: 20, windowMs: 10 * 60_000, lockMs: 5 * 60_000 }
const GLOBAL_KEY = 'adminlogin:global'

function clientKey(event: any): string {
  const h = event.headers || {}
  const xff = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '')
  const ip = xff.split(',')[0].trim() || String(h['x-real-ip'] || h['X-Real-Ip'] || '')
  return 'adminlogin:' + (ip || 'global')
}

async function throttleGate(tkey: string): Promise<number> {
  const [ipWait, globalWait] = await Promise.all([throttleLocked(tkey), throttleLocked(GLOBAL_KEY)])
  return Math.max(ipWait, globalWait)
}
async function throttleFailBoth(tkey: string): Promise<void> {
  await throttleFail(tkey, ADMIN_THROTTLE)
  await throttleFail(GLOBAL_KEY, ADMIN_THROTTLE_GLOBAL)
}

export const main = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, {})
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'POST_ONLY' })

  let req: any
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body
    req = JSON.parse(raw || '{}')
  } catch {
    return reply(400, { ok: false, error: 'BAD_JSON' })
  }
  const { action, key, data = {} } = req

  if (action === 'ping') return reply(200, { ok: true, ts: Date.now() })

  // 认证频控闸：口令校验前先查锁定——per-IP 或全局任一到阈即拒
  const tkey = clientKey(event)
  const wait = await throttleGate(tkey)
  if (wait > 0) return reply(429, { ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfter: Math.ceil(wait / 1000) })

  if (action === 'login') {
    const res = await checkKey(db, key, true)
    if (!res.ok) {
      await throttleFailBoth(tkey)
      return reply(401, res)
    }
    await throttleReset(tkey) // 成功只清 per-IP；全局计数靠滚动窗口自然衰减（防分布式爆破信号丢失）
    // 签发会话令牌（口令不落盘）：前端此后只存/只发令牌；签发失败如实返空、前端 fail-closed 拒登
    const docId = (res as any).agentId === 'admin' ? 'auth' : String((res as any).agentId || 'auth')
    const sessionToken = await issueSession(db, docId, 'pwd').catch(() => '')
    return reply(200, { ...res, sessionToken })
  }

  // loginByWecomCode（企微免登·同 login 受频控）随坐席台批挂载

  // 其余 action 一律先验口令/令牌（同受频控，防经任一 action 入口爆破）
  const auth = await checkKey(db, key, false)
  if (!auth.ok) {
    await throttleFailBoth(tkey)
    return reply(401, auth)
  }
  await throttleReset(tkey)
  // 能力闸·默认拒：登记的取 ACTION_CAPS、未登记默认高权 ADMIN_DEFAULT_CAP；超管 '*' 匹配一切
  const caps: string[] = Array.isArray((auth as any).caps) ? (auth as any).caps : []
  const needCap = ACTION_CAPS[action] || ADMIN_DEFAULT_CAP
  if (!caps.some((c) => c === '*' || c === needCap)) return reply(403, { ok: false, error: 'FORBIDDEN' })
  await ensure(db, 'productsDraft')
  const drafts = db.collection('productsDraft')

  const handler = ACTIONS[action]
  if (!handler) return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  const auditIp = tkey.replace('adminlogin:', '')
  const operator = String((auth as any).operator || 'admin') // 真实操作者身份·多账号可追溯
  const agentId = String((auth as any).agentId || operator)
  try {
    const res = await handler({ db, cloud, data, drafts, agentId, caps })
    if (shouldAudit(action)) await recordAudit({ action, operator, ip: auditIp, data, ok: !!res && res.statusCode === 200 })
    return res
  } catch (e) {
    if (shouldAudit(action)) await recordAudit({ action, operator, ip: auditIp, data, ok: false, error: 'SERVER_ERROR' })
    console.error('adminApi error', action, e)
    return reply(500, { ok: false, error: 'SERVER_ERROR' })
  }
}

/** 业务批挂载口（后续批逐域填 ACTIONS/ACTION_CAPS·与旧线注册表逐行核对）。 */
export const registries = { ACTIONS, ACTION_CAPS }
