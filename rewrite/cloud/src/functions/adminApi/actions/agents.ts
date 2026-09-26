import { reply, ensure, str, newSalt, kdf, keyMatches, alertIfScanAtCap, type Ctx } from '../lib'
import { notifyAlert, getDocOrNull, dayKeyCST, dayStartMsCST } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// 外包账号管理（后台360工作站 §1.5·B5.2·承面C 车道 C·根因#3）：商户超管建/停/列外包坐席账号
// （adminConfig 多账号·role=outsourced 最小权·checkKey 据 keyHash 认账号 + disabled 停用·骨架已在 lib.ts）。
// 本三 action 仅超管可调——**未登记 ACTION_CAPS 默认拒 ADMIN_DEFAULT_CAP**（外包
// 自身 caps 无 admin:write、不能建/停账号·防外包自扩权）。已挂 adminApi ACTIONS。

const AGENT_ROLE = 'outsourced' // 外包最小权角色（ROLES.outsourced·caps 由 role 派生·车道 A 补 agent:handle）

// 企微 userid 唯一性校验（免登不歧义的真实不变量·M⑦ 地基）：loginByWecomCode 按 wecomUserId===userid
// 反查账号，两账号撞同一 userid 会匹配歧义→登错身份。写侧收口唯一性；车道 B 免登侧再补 fail-closed 闸。
// exceptId 排除自身（回填改绑时不误判撞自己）。
// null＝读失败（DB 挂了）——绝不当「没人占用」。调用方回 503，不继续写。
async function wecomUserIdTaken(db: any, wecomUserId: string, exceptId: string): Promise<boolean | null> {
  if (!wecomUserId) return false
  const r = await db
    .collection('adminConfig')
    .where({ wecomUserId })
    .limit(2)
    .get()
    .catch(() => null)
  if (!r) return null
  return (r.data || []).some((a: any) => a._id !== exceptId)
}

// 建外包账号：{ name, key(登录口令), wecomUserId?(企微 userid·可空·免登用) }。keySalt+keyHash 入库（不存明文·
// 批6 加盐 scrypt·同超管 doc）；_id=确定性 agent:<rand>。口令须 ≥6（同 checkKey 下限）且不与既有账号/超管撞
// （撞口令登录会串号）——撞口令判定经 keyMatches 单源（根因#5·同时认得住 legacy sha 存量与带盐新账号两种形态）。
export async function createAgent({ db, data }: Ctx) {
  const name = str((data && data.name) || '', 40).trim()
  const key = String((data && data.key) || '')
  const wecomUserId = str((data && data.wecomUserId) || '', 64).trim()
  if (!name) return reply(400, { ok: false, error: 'BAD_NAME' })
  if (key.length < 6) return reply(400, { ok: false, error: 'KEY_TOO_SHORT' })
  await ensure(db, 'adminConfig')
  const _ = db.command
  // ① 撞口令预检：有界扫描（同 checkKey 手法·最坏 ≤50 行 scrypt 比对，管理端低频操作可接受）+ keyMatches
  // 单源比对——认得住 legacy sha 存量账号与已带盐新账号两种在场形态，不漏判。
  // 读失败不当空扫描：否则预检形同虚设、撞口令也能建号
  const dupScan = await db.collection('adminConfig').where({ keyHash: _.exists(true) }).limit(50).get().catch(() => null)
  if (!dupScan) return reply(503, { ok: false, error: 'KEY_LOOKUP_FAIL' })
  alertIfScanAtCap(dupScan.data || [], 50, 'createAgent.dupScan')
  if ((dupScan.data || []).some((r: any) => keyMatches(r, key))) return reply(409, { ok: false, error: 'KEY_TAKEN' })
  const taken = await wecomUserIdTaken(db, wecomUserId, '')
  if (taken === null) return reply(503, { ok: false, error: 'WECOM_ID_LOOKUP_FAIL' })
  if (taken) return reply(409, { ok: false, error: 'WECOM_ID_TAKEN' })
  const id = 'agent:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const keySalt = newSalt()
  const keyHash = kdf(key, keySalt)
  // _id 由 doc(id) 指定·data 不带 _id（真 sdk set data 含 _id 即 reject·根因#8）
  const doc: any = { name, role: AGENT_ROLE, keySalt, keyHash, disabled: false, createdAt: Date.now() }
  if (wecomUserId) doc.wecomUserId = wecomUserId
  await db.collection('adminConfig').doc(id).set({ data: doc })

  // 写后复核（P2·根因#1 先查后写竞态修复）：上面的 dup/wecomUserIdTaken 都是「先查」，先查后写窗口内
  // 并发双方可能都通过检查各自建号、撞出两账号共享同一口令/wecomUserId（登录串号/免登歧义）。
  // 写完立即重扫描重比对，keyMatches 命中 >1 说明确实撞了——回滚自己刚建的这份、回 409（两侧同时回滚也
  // 安全：都失败重试即可，绝不留双凭证）。复核读失败同样回滚：核验不了的账号不能留。管理端低频操作，多一次读的代价可接受。
  // 回滚失败留痕（病根14）：双凭证残留属身份安全面（共享 keyHash 串号 / 共享企微 userid 免登歧义）。
  const rollback = (which: string) =>
    db
      .collection('adminConfig')
      .doc(id)
      .remove()
      .catch(() => notifyAlert('security', 'createAgent', 'ROLLBACK_FAIL', { id, which }))
  const keyDupScan = await db.collection('adminConfig').where({ keyHash: _.exists(true) }).limit(50).get().catch(() => null)
  if (!keyDupScan) {
    await rollback('keyHash')
    return reply(503, { ok: false, error: 'KEY_LOOKUP_FAIL' })
  }
  alertIfScanAtCap(keyDupScan.data || [], 50, 'createAgent.keyDupScan')
  const keyDupCount = ((keyDupScan.data || []) as any[]).filter((r: any) => keyMatches(r, key)).length
  if (keyDupCount > 1) {
    await rollback('keyHash')
    return reply(409, { ok: false, error: 'KEY_TAKEN' })
  }
  if (wecomUserId) {
    const wDup = await db.collection('adminConfig').where({ wecomUserId }).limit(2).get().catch(() => null)
    if (!wDup || (wDup.data || []).length > 1) {
      await rollback('wecomUserId')
      return wDup ? reply(409, { ok: false, error: 'WECOM_ID_TAKEN' }) : reply(503, { ok: false, error: 'WECOM_ID_LOOKUP_FAIL' })
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
  const taken = await wecomUserIdTaken(db, wecomUserId, id)
  if (taken === null) return reply(503, { ok: false, error: 'WECOM_ID_LOOKUP_FAIL' })
  if (taken) return reply(409, { ok: false, error: 'WECOM_ID_TAKEN' })
  const prevWecomUserId = acct.wecomUserId || ''
  await db.collection('adminConfig').doc(id).update({ data: { wecomUserId, updatedAt: Date.now() } })

  // 写后复核（P2·根因#1 先查后写竞态修复，同 createAgent）：写完重查该 wecomUserId 计数，>1 说明
  // 先查后写窗口内被并发改绑撞号——回滚刚写的这份字段（恢复旧值），绝不留两账号共享同一企微 userid。
  // 复核读失败同样回滚（核验不了的绑定不能留）；回滚失败留痕（同 createAgent）。
  if (wecomUserId) {
    const dup = await db.collection('adminConfig').where({ wecomUserId }).limit(2).get().catch(() => null)
    if (!dup || (dup.data || []).length > 1) {
      await db
        .collection('adminConfig')
        .doc(id)
        .update({ data: { wecomUserId: prevWecomUserId, updatedAt: Date.now() } })
        .catch(() => notifyAlert('security', 'setAgentWecomUserId', 'ROLLBACK_FAIL', { id, which: 'wecomUserId' }))
      return dup ? reply(409, { ok: false, error: 'WECOM_ID_TAKEN' }) : reply(503, { ok: false, error: 'WECOM_ID_LOOKUP_FAIL' })
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
  // 停号同时清空会话（见 lib.ts 会话令牌注释）：否则重新启用时旧令牌跟着复活
  const patch: any = { disabled, updatedAt: Date.now() }
  if (disabled) patch.sessions = []
  await db.collection('adminConfig').doc(id).update({ data: patch })
  return reply(200, { ok: true, id, disabled })
}

// 列外包账号（白名单字段·不回 keyHash·回 wecomUserId 供超管看绑没绑）：id/name/role/disabled/createdAt/wecomUserId。
// B6 看板扩展（坐席个位量级·per-agent 三次有界读/count，无翻页需求）：
//   status/stateUpdatedAt ← agentState 文档（agentDesk.ts setAgentStatus 写；无档兜底 'offline'/null）。
//   activeCount ← csSession {agentId,status:'active'} count（查询写法照 agentDesk.ts activeCountFor 同构
//     内联——文件级隔离先例，不 import 该私有 helper）。
//   todayClosed ← csSession {agentId,status:'closed', updatedAt≥今日零点} count——现场核实：closeConversation
//     转 closed 时 transition() 的 patch 只写 `{ updatedAt: now }`，没有独立 closedAt 字段（见 agentDesk.ts
//     closeConversation），故这里的时间字段就是 updatedAt，不是 closedAt。
//   零写路径：本 action 只读 adminConfig/agentState/csSession 三个集合，原 CRUD 四个 action 零改动。
export async function listAgents({ db }: Ctx) {
  const r = await db
    .collection('adminConfig')
    .where({ role: AGENT_ROLE })
    .limit(50)
    .get() // 读失败上抛（网关 500）——不当「没有外包」（根因#14）
  const rows = (r.data || []) as any[]
  const _ = db.command
  const todayStartMs = dayStartMsCST(dayKeyCST(Date.now())) // 今日零点（CST +08:00·kit/reconcile 单源）
  const agents = await Promise.all(
    rows.map(async (a: any) => {
      const [st, activeR, closedR] = await Promise.all([
        getDocOrNull(db.collection(COLLECTIONS.agentState).doc(a._id)), // 无档＝offline 兜底；读失败不当 offline
        db.collection(COLLECTIONS.csSession).where({ agentId: a._id, status: 'active' }).count(),
        // todayStartMs 恒整数 ms：gt(todayStartMs-1) 等价 gte(todayStartMs)（桩/真 sdk 均无 gte 算子）。
        db
          .collection(COLLECTIONS.csSession)
          .where({ agentId: a._id, status: 'closed', updatedAt: _.gt(todayStartMs - 1) })
          .count(),
      ])
      return {
        id: a._id,
        name: a.name || '',
        role: a.role,
        disabled: !!a.disabled,
        createdAt: a.createdAt || null,
        wecomUserId: a.wecomUserId || '',
        status: (st && st.status) || 'offline',
        stateUpdatedAt: (st && st.updatedAt) || null,
        activeCount: (activeR && activeR.total) || 0,
        todayClosed: (closedR && closedR.total) || 0,
      }
    })
  )
  return reply(200, { ok: true, agents })
}
