import { recordAnomaly } from './anomaly'
import type { AnomalyKind } from '@ldrw/shared'

/**
 * 可观测性告警标记（设计约束「钱链静默失败必须主动可告警」）。
 * 平台指标看不见语义级失败（回调 ACK 200 但金额不符/收钱无单/伪造回调/爆破锁定）——
 * 统一 [LD_ALERT] 结构化单行日志，控制台按关键字配日志告警。
 * 企微机器人推送接缝随观测批接上（届时本函数内部接 botpush 单点，签名不变）。
 * 安全：ctx 只放非敏感标识，绝不放 openid/口令/凭证。绝不抛错（可观测性不反噬主流程）。
 */
export type AlertSev = 'money' | 'security' | 'anomaly'

const MARK = '[LD_ALERT]'

export function alert(sev: AlertSev, fn: string, code: string, ctx: Record<string, unknown> = {}): void {
  try {
    console.error(`${MARK} sev=${sev} fn=${fn} code=${code} ctx=${JSON.stringify(ctx)}`)
  } catch {
    /* 可观测性绝不反噬 */
  }
}

// 告警严重度→异常来源分类（桥接落 bug 账本用）。
const SEV_TO_KIND: Record<AlertSev, AnomalyKind> = {
  money: 'flow-failure', // 钱链动作失败（收钱无单/付款售罄/退款回调异常/发货上传失败）
  security: 'server-exception', // 安全/验签/客服探针失败
  anomaly: 'invariant-violation', // 兜底（一般由 recordAnomaly 直发 alert·不经此）
}

/**
 * 告警 + 企微推送（推送接缝随观测批接上·签名不变·现落 [LD_ALERT] 行）+ **桥接落 bug 账本**（批4·病根14 持久化延伸）：
 * 所有动作失败告警自动进 anomalies 账本·控制台可查·指纹去重不刷屏。alertOnHigh:false——本函数已 alert 过、
 * recordAnomaly 不再重复推告警（防递归 + 防双日志）。fail-soft：落账失败绝不反噬告警本身。
 */
export async function notifyAlert(sev: AlertSev, fn: string, code: string, ctx: Record<string, unknown> = {}): Promise<void> {
  alert(sev, fn, code, ctx)
  try {
    await recordAnomaly(SEV_TO_KIND[sev], code, { fn, ...ctx }, 'high', { alertOnHigh: false })
  } catch {
    /* 可观测性绝不反噬主流程 */
  }
}

/** 召回汇总推运营群（同上·botpush 接缝随观测批接上·现仅落结构化行）。 */
export async function notifyRecall(summary: Record<string, number>): Promise<void> {
  try {
    console.error(`[LD_RECALL] ${JSON.stringify(summary)}`)
  } catch {
    /* fail-soft */
  }
}
