import { reply, sha, ensure, str, type Ctx } from '../lib'

// 外包账号管理（后台360工作站 §1.5·B5.2·承面C 车道 C·根因#3）：商户超管建/停/列外包坐席账号
// （adminConfig 多账号·role=outsourced 最小权·checkKey 据 keyHash 认账号 + disabled 停用·骨架已在 lib.ts）。
// 本三 action 仅超管可调——**未登记 ACTION_CAPS 默认拒 ADMIN_DEFAULT_CAP**（守卫 agent-rbac-gated·外包
// 自身 caps 无 admin:write、不能建/停账号·防外包自扩权）。
//
// ⚠️ 5 单源面归 master（车道 C 只报·见 ready 报告）：ACTIONS 注册（index.ts）+ ACTION_CAPS（默认拒即够·
// 无须显式登记）+ 系统事实.md action 目录。本文件只实现 action 函数，master 整合时 wire。

const AGENT_ROLE = 'outsourced' // 外包最小权角色（ROLES.outsourced·caps 由 role 派生·车道 A 补 agent:handle）

// 建外包账号：{ name, key(登录口令) }。keyHash 入库（不存明文·同超管 doc）；_id=确定性 agent:<rand>。
// 口令须 ≥6（同 checkKey 下限）且不与既有账号/超管撞（撞 keyHash 登录会串号）。
export async function createAgent({ db, data }: Ctx) {
  const name = str((data && data.name) || '', 40).trim()
  const key = String((data && data.key) || '')
  if (!name) return reply(400, { ok: false, error: 'BAD_NAME' })
  if (key.length < 6) return reply(400, { ok: false, error: 'KEY_TOO_SHORT' })
  await ensure(db, 'adminConfig')
  const keyHash = sha(key)
  const dup = await db
    .collection('adminConfig')
    .where({ keyHash })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  if (dup.data && dup.data.length) return reply(409, { ok: false, error: 'KEY_TAKEN' })
  const id = 'agent:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  // _id 由 doc(id) 指定·data 不带 _id（真 sdk set data 含 _id 即 reject·根因#8·no-id-in-set-data）
  await db
    .collection('adminConfig')
    .doc(id)
    .set({ data: { name, role: AGENT_ROLE, keyHash, disabled: false, createdAt: Date.now() } })
  return reply(200, { ok: true, agent: { id, name, role: AGENT_ROLE, disabled: false } })
}

// 停/启外包账号：{ id, disabled }（disabled=true 停·false 启）。只作用于 outsourced agent doc（不许停超管）。
export async function disableAgent({ db, data }: Ctx) {
  const id = String((data && data.id) || '')
  const disabled = !!(data && data.disabled)
  if (!id || id === 'auth') return reply(400, { ok: false, error: 'BAD_ID' }) // 'auth'＝超管·不许停
  const got = await db
    .collection('adminConfig')
    .doc(id)
    .get()
    .catch(() => null)
  const acct = got && got.data
  if (!acct || acct.role !== AGENT_ROLE) return reply(404, { ok: false, error: 'AGENT_NOT_FOUND' })
  await db.collection('adminConfig').doc(id).update({ data: { disabled, updatedAt: Date.now() } })
  return reply(200, { ok: true, id, disabled })
}

// 列外包账号（白名单字段·不回 keyHash）：id/name/role/disabled/createdAt。
export async function listAgents({ db }: Ctx) {
  const r = await db
    .collection('adminConfig')
    .where({ role: AGENT_ROLE })
    .get()
    .catch(() => ({ data: [] }))
  const agents = (r.data || []).map((a: any) => ({
    id: a._id,
    name: a.name || '',
    role: a.role,
    disabled: !!a.disabled,
    createdAt: a.createdAt || null,
  }))
  return reply(200, { ok: true, agents })
}
