/**
 * 可观测性告警标记（设计约束「钱链静默失败必须主动可告警」）。
 * 平台指标看不见语义级失败（回调 ACK 200 但金额不符/收钱无单/伪造回调/爆破锁定）——
 * 统一 [LD_ALERT] 结构化单行日志，控制台按关键字配日志告警。
 * 企微机器人推送接缝随观测批接上（届时本函数内部接 botpush 单点，签名不变）。
 * 安全：ctx 只放非敏感标识，绝不放 openid/口令/凭证。绝不抛错（可观测性不反噬主流程）。
 */
export type AlertSev = 'money' | 'security'

const MARK = '[LD_ALERT]'

export function alert(sev: AlertSev, fn: string, code: string, ctx: Record<string, unknown> = {}): void {
  try {
    console.error(`${MARK} sev=${sev} fn=${fn} code=${code} ctx=${JSON.stringify(ctx)}`)
  } catch {
    /* 可观测性绝不反噬 */
  }
}
