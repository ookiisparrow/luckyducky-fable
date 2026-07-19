import { getDb } from './db'
import { COLLECTIONS } from '@ldrw/shared'

// 操作审计（操作审计#4·根因#3 信任边界可追溯）：管理端动钱/状态的操作留「谁·何时·做了什么·成没成」痕，
// 退款/发货/改价/调库存事后可查。单一收口（守卫 admin-actions-audited）：仅 adminApi 分发处经 recordAudit
// 写 auditLog。**fail-soft**：审计失败绝不反噬业务响应。安全（CLAUDE §7）：凭证（口令 key/密码/webhook）
// 不入审计——summary 已剥。operator＝真实操作者账号身份（B5.4·§1.5·多账号 RBAC 上线后由 checkKey 解析后贯入·
// 见 adminApi/index.ts；缺省回退 'admin' 保 fail-soft 与向后兼容）——留痕「谁查/改了谁」，非再糊成单口令 admin。

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
  operator?: string
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
          operator: String(entry.operator || 'admin').slice(0, 60),
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

// 破例强制审计（§1.5·根因#3）：读他人全貌/检索他人的 360 越权面 action（getCustomer360 聚合 / getUser 单人画像 /
// searchCustomer 检索客户 / getSessionCustomer360 外包按会话 scoped 读）以 get 开头会被下方 ^get 跳过——但坐席
// 批量读他人订单/PII/学习轨迹必须留痕（防 0 痕）。名单内 action 无视 ^get 跳过、一律记。守卫 cs-360-read-audited 焊四者在册（删一个即红）。
const FORCE_AUDIT = new Set(['getCustomer360', 'getUser', 'searchCustomer', 'getSessionCustomer360'])

// 是否审计：跳过只读（list*/get*）+ 媒体上传（upload*·高频大件噪声）+ ping/login（认证·已有频控审计语义）；
// 其余（save*/ship*/approve*/reject*/publish*/delete*/clear*/create* 等动钱动状态）一律记。
// FORCE_AUDIT 名单破例（§1.5 越权读）：无视 ^get 跳过、强制留痕。
export function shouldAudit(action: string): boolean {
  if (FORCE_AUDIT.has(action)) return true
  // 批 B7 排除：reportClientError 是高频遥测（web 前端错误上报），非操作者动钱/动状态动作——同 upload* 噪声
  // 豁免精神，它自己的账本是 anomalies（kit/anomaly.ts）不是 auditLog；否则该名不以 list/get/upload 开头会被
  // 默认正则判进操作审计，把 auditLog 刷成错误日志噪声。
  if (action === 'reportClientError') return false
  return !/^(list|get|upload)/.test(action) && action !== 'ping' && action !== 'login'
}
