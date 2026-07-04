import cloud from 'wx-server-sdk'
import { ERR, COLLECTIONS } from '@ldrw/shared'
import { getDb } from './db'
import { err } from './reply'

export interface OpenIdCtx {
  db: any
  OPENID: string
  event: any
}

/**
 * openid 闸（设计约束#3：安检 fail-closed 结构强制——不过闸写不出库）。
 * 无可信 openid 直接拒；有则注入 { db, OPENID, event } 执行 handler。
 */
export function withOpenId(handler: (ctx: OpenIdCtx) => Promise<any>) {
  return async (event: any) => {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) return err(ERR.NO_OPENID)
    return handler({ db: getDb(), OPENID, event })
  }
}

/** 当前调用者 unionid（绑开放平台才有值·否则 ''）：身份桥接用。身份原语收口 kit。 */
export function currentUnionId(): string {
  return cloud.getWXContext().UNIONID || ''
}

/**
 * 回调防伪判定（设计约束#3 全场最关键）：回调只应由工作流服务端调用（无用户上下文）；
 * 客户端 callFunction 必带 OPENID，带身份即视为伪造。无 OPENID → true（可信服务端调用）。
 */
export function isServerCall(): boolean {
  return !cloud.getWXContext().OPENID
}

/**
 * 管理闸（设计约束#3）：CLI/控制台服务端调用（无 openid）放行；客户端（带 openid）须
 * users.isAdmin===true——防任意登录用户 callFunction 覆盖生产数据（越不像业务的入口越要默认拒）。
 */
export function withAdminGate(handler: (ctx: OpenIdCtx) => Promise<any>) {
  return async (event: any) => {
    const db = getDb()
    const { OPENID } = cloud.getWXContext()
    if (OPENID) {
      const u = await db.collection(COLLECTIONS.users).where({ _openid: OPENID }).get()
      if (!u.data.length || u.data[0].isAdmin !== true) return err(ERR.ADMIN_ONLY)
    }
    return handler({ db, OPENID, event })
  }
}
