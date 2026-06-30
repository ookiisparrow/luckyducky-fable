import { reply, type Ctx } from '../lib'
import { assembleCustomer360 } from '../customer360/orchestrator'

// 客户360 只读查询（B1.1·M①）：按 openid 聚合该客人全貌（订单/激活…经 provider registry·铁律三）。
// 越权面（坐席批量读他人数据·§1.5·根因#3）双闸，均在 index.ts 分发处集中收口（守卫焊·本 action 不自己碰审计/能力）：
//   ① 能力闸 ACTION_CAPS['getCustomer360']='customer:view'·分发前校验 caps（cs-360-rbac-gated）；
//   ② 强制留痕：FORCE_AUDIT 含 getCustomer360·分发后经 kit/audit 记痕（shouldAudit 跳 ^get·本 action 破例·cs-360-read-audited）。
// 本 action 只负责取 openid → 编排 → 回结果（读类·不写库）。
export async function getCustomer360({ db, data }: Ctx) {
  const openid = String((data && data.openid) || '').trim()
  if (!openid) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const result = await assembleCustomer360(db, openid)
  return reply(200, { ok: true, ...result })
}
