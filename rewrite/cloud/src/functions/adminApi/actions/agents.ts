import { reply, sha, ensure, str, type Ctx } from '../lib'

// 外包账号管理（后台360工作站 §1.5·B5.2·承面C 车道 C·根因#3）：商户超管建/停/列外包坐席账号
// （adminConfig 多账号·role=outsourced 最小权·checkKey 据 keyHash 认账号 + disabled 停用·骨架已在 lib.ts）。
// 本三 action 仅超管可调——**未登记 ACTION_CAPS 默认拒 ADMIN_DEFAULT_CAP**（守卫 agent-rbac-gated·外包
// 自身 caps 无 admin:write、不能建/停账号·防外包自扩权）。
//
// ⚠️ 5 单源面归 master（车道 C 只报·见 ready 报告）：ACTIONS 注册（index.ts）+ ACTION_CAPS（默认拒即够·
// 无须显式登记）+ 系统事实.md action 目录。本文件只实现 action 函数，master 整合时 wire。

const AGENT_ROLE = 'outsourced' // 外包最小权角色（ROLES.outsourced·caps 由 role 派生·车道 A 补 agent:handle）

// 企微 userid 唯一性校验（免登不歧义的真实不变量·M⑦ 地基）：loginByWecomCode 按 wecomUserId===userid
// 反查账号，两账号撞同一 userid 会匹配歧义→登错身份。写侧收口唯一性；车道 B 免登侧再补 fail-closed 闸。
// exceptId 排除自身（回填改绑时不误判撞自己）。
async function wecomUserIdTaken(db: any, wecomUserId: string, exceptId: string): Promise<boolean> {
  if (!wecomUserId) return false
  const r = await db
    .collection('adminConfig')
    .where({ wecomUserId })
    .get()
    .catch(() => ({ data: [] }))
  return (r.data || []).some((a: any) => a._id !== exceptId)
}

// 建外包账号：{ name, key(登录口令), wecomUserId?(企微 userid·可空·免登用) }。keyHash 入库（不存明文·同超管 doc）；
// _id=确定性 agent:<rand>。口令须 ≥6（同 checkKey 下限）且不与既有账号/超管撞（撞 keyHash 登录会串号）。
export async function createAgent({ db, data }: Ctx) {
  const name = str((data && data.name) || '', 40).trim()
  const key = String((data && data.key) || '')
  const wecomUserId = str((data && data.wecomUserId) || '', 64).trim()
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
  if (await wecomUserIdTaken(db, wecomUserId, '')) return reply(409, { ok: false, error: 'WECOM_ID_TAKEN' })
  const id = 'agent:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  // _id 由 doc(id) 指定·data 不带 _id（真 sdk set data 含 _id 即 reject·根因#8·no-id-in-set-data）
  const doc: any = { name, role: AGENT_ROLE, keyHash, disabled: false, createdAt: Date.now() }
  if (wecomUserId) doc.wecomUserId = wecomUserId
  await db.collection('adminConfig').doc(id).set({ data: doc })

  // 写后复核（P2·根因#1 先查后写竞态修复）：上面的 dup/wecomUserIdTaken 都是「先查」，先查后写窗口内
  // 并发双方可能都通过检查各自建号、撞出两账号共享同一 keyHash/wecomUserId（登录串号/免登歧义）。
  // 写完立即重查计数，>1 说明确实撞了——回滚自己刚建的这份、回 409（两侧同时回滚也安全：都失败重试即可，
  // 绝不留双凭证）。管理端低频操作，多一次读的代价可接受。
  const keyDup = await db.collection('adminConfig').where({ keyHash }).get().catch(() => ({ data: [] }))
  if ((keyDup.data || []).length > 1) {
    await db.collection('adminConfig').doc(id).remove().catch(() => {})
    return reply(409, { ok: false, error: 'KEY_TAKEN' })
  }
  if (wecomUserId) {
    const wDup = await db.collection('adminConfig').where({ wecomUserId }).get().catch(() => ({ data: [] }))
    if ((wDup.data || []).length > 1) {
      await db.collection('adminConfig').doc(id).remove().catch(() => {})
      return reply(409, { ok: false, error: 'WECOM_ID_TAKEN' })
    }
  }
  return reply(200, { ok: true, agent: { id, name, role: AGENT_ROLE, disabled: false, wecomUserId } })
}

// 回填/改绑企微 userid：{ id, wecomUserId(空串=解绑) }。作用于外包账号或超管 'auth'（超管也可免登·M⑦ §2.2）。
// 唯一性校验防两账号撞 userid（免登歧义）。仅超管可调（未登记 ACTION_CAPS→默认拒 admin:write·同建/停）。
export async function setAgentWecomUserId({ db, data }: Ctx) {
  const id = String((data && data.id) || '')
  const wecomUserId = str((data && data.wecomUserId) || '', 64).trim()
  if (!id) return reply(400, { ok: false, error: 'BAD_ID' })
  const got = await db
    .collection('adminConfig')
    .doc(id)
    .get()
    .catch(() => null)
  const acct = got && got.data
  // 只作用于真实账号（超管 auth 或 outsourced agent）——防往任意 doc 塞字段
  if (!acct || !(id === 'auth' || acct.role === AGENT_ROLE)) return reply(404, { ok: false, error: 'AGENT_NOT_FOUND' })
  if (await wecomUserIdTaken(db, wecomUserId, id)) return reply(409, { ok: false, error: 'WECOM_ID_TAKEN' })
  const prevWecomUserId = acct.wecomUserId || ''
  await db.collection('adminConfig').doc(id).update({ data: { wecomUserId, updatedAt: Date.now() } })

  // 写后复核（P2·根因#1 先查后写竞态修复，同 createAgent）：写完重查该 wecomUserId 计数，>1 说明
  // 先查后写窗口内被并发改绑撞号——回滚刚写的这份字段（恢复旧值），绝不留两账号共享同一企微 userid。
  if (wecomUserId) {
    const dup = await db.collection('adminConfig').where({ wecomUserId }).get().catch(() => ({ data: [] }))
    if ((dup.data || []).length > 1) {
      await db
        .collection('adminConfig')
        .doc(id)
        .update({ data: { wecomUserId: prevWecomUserId, updatedAt: Date.now() } })
        .catch(() => {})
      return reply(409, { ok: false, error: 'WECOM_ID_TAKEN' })
    }
  }
  return reply(200, { ok: true, id, wecomUserId })
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

// 列外包账号（白名单字段·不回 keyHash·回 wecomUserId 供超管看绑没绑）：id/name/role/disabled/createdAt/wecomUserId。
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
    wecomUserId: a.wecomUserId || '',
  }))
  return reply(200, { ok: true, agents })
}
