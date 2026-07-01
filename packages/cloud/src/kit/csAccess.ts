import { COLLECTIONS } from './collections'

/**
 * 承面 C 外包会话访问控制闸（后台360工作站 §1.5·B3.3/B6·承面C 车道 C·根因#3 信任边界 fail-closed）。
 *
 * 两条独立不变量，各配守卫（车道 A 坐席台 action 对 outsourced 角色调用这两闸；商户超管＝数据控制者·
 * 走原 customer360 路径·现有隐私政策覆盖·不经本闸）：
 *  - assertDataShareConsent（守卫 cs-data-share-consented·C1）：第三方（外包/企微坐席≠商户本人）看某客户
 *    360 数据前，该客户须已「告知同意」数据共享（users.csDataShare.agreed===true）——未同意即拒（fail-closed）。
 *    声明文案在协议/隐私页；法律口径是否需独立同意归律师，本层只机械化「有同意才放行」。
 *  - assertOwnedByAgent（守卫 outsourced-reads-scoped·C3）：外包坐席读某会话/对应 360 须是自己 claim 的会话
 *    （csSession.agentId===本坐席 agentId）——防一个外包账号遍历全量客户 360＝批量导出。
 *
 * 两闸返回 { ok, error? }（**不 throw**：adminApi 分发对 throw 一律 500·返 { ok:false } 让调用方 reply(403)
 * 更准）。fail-closed：任何缺参/查不到/不匹配一律 ok:false，不默认放行。
 */

/** 数据共享告知同意闸（C1·fail-closed）：客户须已同意第三方数据共享，否则拒。 */
export async function assertDataShareConsent(db: any, openid: string): Promise<{ ok: boolean; error?: string }> {
  const id = String(openid || '').trim()
  if (!id) return { ok: false, error: 'NO_CONSENT' } // 无从识别客户＝无从确认同意·fail-closed
  const r = await db
    .collection(COLLECTIONS.users)
    .where({ _openid: id })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  const u = (r && r.data && r.data[0]) || null
  const agreed = !!(u && u.csDataShare && u.csDataShare.agreed === true)
  return agreed ? { ok: true } : { ok: false, error: 'NO_CONSENT' }
}

/** 外包会话归属 scope 闸（C3·fail-closed）：会话须存在且 agentId===本坐席，否则拒（防越 scope 批量导出）。 */
export async function assertOwnedByAgent(
  db: any,
  agentId: string,
  sessionId: string,
): Promise<{ ok: boolean; session?: any; error?: string }> {
  const aid = String(agentId || '').trim()
  const sid = String(sessionId || '').trim()
  if (!aid || !sid) return { ok: false, error: 'BAD_SCOPE' } // 缺坐席/会话标识·fail-closed
  const got = await db.collection(COLLECTIONS.csSession).doc(sid).get().catch(() => null)
  const session = (got && got.data) || null
  if (!session) return { ok: false, error: 'NO_SESSION' } // 会话不存在·fail-closed
  if (String(session.agentId || '') !== aid) return { ok: false, error: 'NOT_OWNER' } // 非本坐席 claim·拒
  return { ok: true, session }
}
