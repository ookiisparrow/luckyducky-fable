import { getDb } from './db'
import { COLLECTIONS } from './collections'

// 操作审计（操作审计#4·根因#3 信任边界可追溯）：管理端动钱/状态的操作留「谁·何时·做了什么·成没成」痕，
// 退款/发货/改价/调库存事后可查。单一收口（守卫 admin-actions-audited）：仅 adminApi 分发处经 recordAudit
// 写 auditLog。**fail-soft**：审计失败绝不反噬业务响应。安全（CLAUDE §7）：凭证（口令 key/密码/webhook）
// 不入审计——summary 已剥。operator 暂为单口令 'admin'（多用户后扩为真实身份，痕迹结构已就位）。

const SENSITIVE = new Set(['key', 'password', 'pwd', 'alertWebhook', 'webhook', 'secret', 'token'])

// 非敏感摘要：剥凭证、对象/数组只留形状、长字段截断（绝不存原始 data 防泄密 + 防膨胀）
function summarize(data: any): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE.has(k) || v == null) continue
    out[k] = typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : String(v).slice(0, 80)
  }
  return out
}

/** 记一条管理端操作审计；**fail-soft——绝不抛错**（审计不反噬业务）。 */
export async function recordAudit(entry: {
  action: string
  ip?: string
  data?: any
  ok: boolean
  error?: string
}): Promise<void> {
  try {
    await getDb()
      .collection(COLLECTIONS.auditLog)
      .add({
        data: {
          action: entry.action,
          operator: 'admin',
          ip: String(entry.ip || '').slice(0, 60),
          summary: summarize(entry.data),
          ok: !!entry.ok,
          error: entry.error ? String(entry.error).slice(0, 80) : '',
          ts: Date.now(),
        },
      })
  } catch {
    /* fail-soft：审计不反噬业务响应 */
  }
}

// 是否审计：跳过只读（list*/get*）+ 媒体上传（upload*·高频大件噪声）+ ping/login（认证·已有频控审计语义）；
// 其余（save*/ship*/approve*/reject*/publish*/delete*/clear*/create* 等动钱动状态）一律记。
export function shouldAudit(action: string): boolean {
  return !/^(list|get|upload)/.test(action) && action !== 'ping' && action !== 'login'
}
