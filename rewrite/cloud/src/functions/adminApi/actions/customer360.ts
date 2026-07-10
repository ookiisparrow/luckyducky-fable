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

// ── B1.2 检索 + 单人画像（同属 360 越权读·§1.5·根因#3）──
// 双闸同 getCustomer360：ACTION_CAPS['searchCustomer'/'getUser']='customer:view'（cs-360-rbac-gated）
// + FORCE_AUDIT 含两者（cs-360-read-audited·getUser 以 get 开头会被 shouldAudit 跳·破例留痕）。闸在 index.ts 分发处收口。

const SEARCH_LIMIT = 20 // bounded（防一次拉爆 users·大库友好）

// 客户检索（B1.2）：按 openid / 手机号 / 订单号 / 昵称 命中客户，返匹配 openid + 摘要供坐席选人 → getCustomer360。
// 各键精确匹配（内存桩与真 sdk 都支持的 where 等值）：openid/phone/nickname 直查 users；orderId 反查 orders→_openid。
// 昵称模糊（db.RegExp 子串）须真 sdk + 索引、内存桩不复现（根因#8 桩≠真），故先精确、不造不可测的模糊分支（防过度工程·留待真机验后再升级）。
export async function searchCustomer({ db, data }: Ctx) {
  const q = String((data && data.q) || '').trim().slice(0, 64)
  if (!q) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const found = new Map<string, any>() // openid → 摘要（去重·一人多键命中合并 matchedBy）
  const add = (u: any, by: string) => {
    const openid = String((u && (u._openid || u._id)) || '')
    if (!openid) return
    const cur = found.get(openid)
    if (cur) {
      if (!cur.matchedBy.includes(by)) cur.matchedBy.push(by)
      return
    }
    found.set(openid, {
      openid,
      nickname: (u && u.nickname) || '',
      phone: (u && u.phone) || '',
      avatar: (u && u.avatar) || '',
      createdAt: (u && u.createdAt) || null,
      matchedBy: [by],
    })
  }
  const users = db.collection('users')
  const rows = (qy: any) =>
    qy
      .get()
      .then((r: any) => (r && r.data) || [])
      .catch(() => [])
  const [byId, byPhone, byNick] = await Promise.all([
    rows(users.where({ _openid: q }).limit(SEARCH_LIMIT)),
    rows(users.where({ phone: q }).limit(SEARCH_LIMIT)),
    rows(users.where({ nickname: q }).limit(SEARCH_LIMIT)),
  ])
  byId.forEach((u: any) => add(u, 'openid'))
  byPhone.forEach((u: any) => add(u, 'phone'))
  byNick.forEach((u: any) => add(u, 'nickname'))
  // 订单号反查客户（坐席常拿单号来）：orders.doc(q) → _openid → 取其 users 摘要（无档也回 openid·让坐席仍能查 360）
  const ord = await db.collection('orders').doc(q).get().catch(() => null)
  if (ord && ord.data && ord.data._openid) {
    const u = await rows(users.where({ _openid: ord.data._openid }).limit(1))
    if (u.length) add(u[0], 'orderId')
    else add({ _openid: ord.data._openid }, 'orderId')
  }
  const customers = [...found.values()].slice(0, SEARCH_LIMIT)
  return reply(200, { ok: true, count: customers.length, customers })
}

// 单客户画像（B1.2）：读 users 一条（建档 _id=openid·老档随机 _id → 统一按 _openid 查兼容两者·bounded limit 1）。
// 白名单字段回（不回原始档全字段）；无档（未登录过/老数据）回 user:null 不报错。
// DB 异常与「真无档」分离（P1·bug 清除战役II F5）：原 .catch(() => ({data:[]})) 把查询异常与查无结果
// 折叠成同一个 {ok:true,user:null}——批D 的 userLoadFailed 前端分支因此永远命中不到最常见的失败（DB 异常）。
// 改：查询异常回 null（≠真查无结果的 {data:[]}）→ 单独识别为 ok:false；「真查无结果」保持 ok:true+user:null 不变。
export async function getUser({ db, data }: Ctx) {
  const openid = String((data && data.openid) || '').trim()
  if (!openid) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const r = await db
    .collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get()
    .catch(() => null)
  if (!r) return reply(200, { ok: false, error: 'USER_LOOKUP_FAIL' })
  const u = (r.data && r.data[0]) || null
  if (!u) return reply(200, { ok: true, user: null }) // 真查无结果——如实回 null，不算失败
  return reply(200, {
    ok: true,
    user: {
      openid: u._openid || u._id,
      nickname: u.nickname || '',
      avatar: u.avatar || '',
      phone: u.phone || '',
      bio: u.bio || '',
      createdAt: u.createdAt || null,
      updatedAt: u.updatedAt || null,
    },
  })
}
