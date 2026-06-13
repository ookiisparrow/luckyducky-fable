import cloud from 'wx-server-sdk'
import { ERR } from '@luckyducky/shared'
import { getDb } from './db'
import { err } from './reply'

export interface OpenIdCtx {
  db: any
  OPENID: string
  event: any
}

/**
 * openid 闸（根因账本 #3：收编 18 处三行闸样板，fail-closed 缺省）。
 * 无可信 openid 直接拒；有则注入 { db, OPENID, event } 执行 handler。
 */
export function withOpenId(handler: (ctx: OpenIdCtx) => Promise<any>) {
  return async (event: any) => {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) return err(ERR.NO_OPENID)
    return handler({ db: getDb(), OPENID, event })
  }
}

/**
 * 回调防伪（根因账本 #3，审核批次A-1 全场最关键）：
 * 回调只应由工作流服务端调用（无用户上下文）；客户端 callFunction 必带 OPENID，
 * 带身份即视为伪造。无 OPENID → true（可信服务端调用）。
 */
export function isServerCall(): boolean {
  return !cloud.getWXContext().OPENID
}
