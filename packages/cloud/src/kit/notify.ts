import { getDb } from './db'
import { isServerCall } from './gate'

export interface NotifyOptions<E> {
  /** 给微信的 ACK（不返回 ACK 微信会重试推送）。 */
  ack: Record<string, unknown>
  /** 从通知事件提取单据 id（out_trade_no / out_refund_no）；空则忽略（缺单号）。 */
  refId: (event: E) => string
  /**
   * 处理通知（载入单据、核验、状态流转、留痕——全在此；db/id/event 注入）。
   * 成功/非成功/金额不符的判定各回调自理：payCallback 只在成功时翻单，
   * refundCallback 非成功也留 refundStatus 痕。
   */
  onNotify: (ctx: { db: any; id: string; event: E }) => Promise<void>
}

/**
 * 回调框架（根因账本 #3/#5：收编 payCallback↔refundCallback 共同骨架）。
 * 共享外壳：**防伪闸**（带用户身份=客户端伪造，静默 ACK 不给探测信号——根因#3 全场最关键）→
 * 提取单据 id（缺则静默 ACK）→ onNotify 处理 → ACK。
 * 防伪闸由框架强制：任何回调不经框架写不出来，杜绝「忘记防伪」。
 */
export function defineNotifyCallback<E>(opts: NotifyOptions<E>) {
  return async (event: E) => {
    if (!isServerCall()) {
      console.error('[notify] 拒绝带用户身份的调用（疑似客户端伪造）')
      return opts.ack
    }
    const id = opts.refId(event || ({} as E))
    if (!id) return opts.ack
    await opts.onNotify({ db: getDb(), id, event })
    return opts.ack
  }
}
