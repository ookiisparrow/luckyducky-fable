import { getDb } from './db'
import { isServerCall } from './gate'

export interface NotifyOptions<E> {
  /** 给微信的 ACK（不返回 ACK 微信会重试推送）。 */
  ack: Record<string, unknown>
  /** 从通知事件解析出单据 id 与是否成功；返回 null 或空 id 即忽略（缺单号）。 */
  parse: (event: E) => { id: string; success: boolean } | null
  /** 成功通知的幂等处理（状态翻转等）；db/id/event 注入。 */
  onSuccess: (ctx: { db: any; id: string; event: E }) => Promise<void>
}

/**
 * 回调框架（根因账本 #3/#5：收编 payCallback↔refundCallback 70% 重复）。
 * 共同骨架：防伪闸（带用户身份=伪造，静默 ACK 不给探测信号）→ parse →
 * （缺单号 / 未成功）静默 ACK → onSuccess 幂等处理 → ACK。
 * 各回调只写自己的 parse + onSuccess（特定状态流转）。
 */
export function defineNotifyCallback<E>(opts: NotifyOptions<E>) {
  return async (event: E) => {
    if (!isServerCall()) {
      console.error('[notify] 拒绝带用户身份的调用（疑似客户端伪造）')
      return opts.ack
    }
    const parsed = opts.parse(event || ({} as E))
    if (!parsed || !parsed.id) return opts.ack
    if (!parsed.success) return opts.ack
    await opts.onSuccess({ db: getDb(), id: parsed.id, event })
    return opts.ack
  }
}
