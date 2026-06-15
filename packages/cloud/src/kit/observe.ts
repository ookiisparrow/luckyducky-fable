// 可观测性告警标记（债#23 代码侧·根因#13/钱链可观测）。
//
// 平台自带指标（腾讯云 cloudbase 调用量/错误率/P95）看不见「语义级/静默失败」——回调返 ACK 200
// 但金额不符 / 收到未知订单的成功通知 / 退款与售后单不符 / 防伪回调命中 / 爆破锁定。这些用统一
// 标记 [LD_ALERT] 打结构化单行日志，控制台对该关键字配**日志告警 + 企业微信推送**（外部步骤·靠
// 人），即把代码侧信号桥到原生告警——平台指标管「函数挂没挂」，本标记管「钱链对不对/被没被刷」。
//
// 一个标记一条规则，sev 分流：money＝钱链失败·须人介入对账；security＝爆破/伪造·安全事件。
// 安全（CLAUDE §7 敏感信息不进日志）：ctx 只放非敏感标识（orderId/金额分/状态/IP/节流 key），
// 绝不放 openid / 口令 / 凭证。
export type AlertSev = 'money' | 'security'

const MARK = '[LD_ALERT]'

/** 打一条可被控制台日志告警抓取的结构化告警行；绝不抛错（可观测性不能反噬主流程）。 */
export function alert(
  sev: AlertSev,
  fn: string,
  code: string,
  ctx: Record<string, unknown> = {}
): void {
  let tail = ''
  try {
    tail = ' ' + JSON.stringify(ctx)
  } catch {
    tail = ' <ctx-unserializable>'
  }
  console.error(`${MARK} sev=${sev} fn=${fn} code=${code}${tail}`)
}
