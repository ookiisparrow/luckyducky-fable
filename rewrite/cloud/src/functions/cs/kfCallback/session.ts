import { COLLECTIONS } from '@ldrw/shared'
import { alert, transition, sendAgentCard, AGENT_DESK_URL } from '../../../kit'
import { docData } from './store'

/**
 * 「谁在接待」单源判定：pending/active/escalated＝人工链路占用中
 * （bot 须让位）→ 返状态串；closed/无会话＝bot 可应答 → 返 null。handleMessage 与 index.ts 进会话欢迎
 * （enter_session）都过它——若只有 handleMessage 查、enter_session 直发欢迎菜单，排队中顾客重开聊天窗会被
 * bot 抢话（且点菜单又被本闸静默＝发了菜单点了没反应的自相矛盾）。
 */
export async function heldStatus(
  db: any,
  openKfId: string,
  externalUserId: string
): Promise<string | null> {
  const held = await docData(db, COLLECTIONS.csSession, 'wxkf:' + openKfId + ':' + externalUserId)
  const hs = held && held.status
  return hs === 'pending' || hs === 'active' || hs === 'escalated' ? hs : null
}

// ── 会话入队（csSession 的 writer·会话进自建工作台待接队列）──
/**
 * 转人工时把这通会话写入 csSession 待接队列（坐席台 `listQueue` 读它）。
 * 确定性 _id=`wxkf:<openKfId>:<externalUserId>`（一顾客一活会话）：用 `add`——撞 id 即会话已在队列
 * （pending/active/…）→ 抛错被吞 → **不 clobber**（坐席已认领的 active 不被顾客再点转人工重置回 pending·根因#1 幂等）。
 * 创建于**初始态 pending**（cs.spec.ts `initial`）——非 `transition()`（状态流转 claim/close/escalate 是坐席台 action）。
 * best-effort：入队失败不反噬顾客回复/平台转接（同 ensureKfIdentity）。closed 会话重开为新 pending 属会话生命周期。
 */
/**
 * 三态返回（同 firstSeen 三态款·根因#8）：'queued'＝真正新入队（首建/closed 重开）；'already'＝已在
 * 队列/接待中（撞号不 clobber）；'failed'＝基建错（add 没写进去且回查确认 doc 不存在）——**绝不可当成功**：
 * 若把任何 add 异常都当撞号吞掉，DB 故障时会话没入队、顾客却收到「已为你转接」＝假转接无人接。
 * 调用方（transfer 分支）据 'failed' 改话术如实提示重试。
 */
export async function enqueueSession(
  db: any,
  openKfId: string,
  externalUserId: string
): Promise<'queued' | 'already' | 'failed'> {
  const euid = String(externalUserId || '')
  if (!euid || !openKfId) return 'failed' // 不造无主会话
  const now = Date.now()
  const id = 'wxkf:' + openKfId + ':' + euid
  let queued = false // 真正新入队（首建 or closed 重开）才推送——已在 pending/active 的不重复骚扰坐席
  try {
    await db.collection(COLLECTIONS.csSession).add({
      data: {
        _id: id,
        status: 'pending',
        externalUserId: euid,
        openKfId,
        createdAt: now,
        updatedAt: now,
      },
    })
    queued = true
  } catch {
    // add 失败先回查：doc 真存在＝撞确定性 _id（正常幂等路径）；不存在＝基建错（DB 权限/瞬时）→ 'failed' 如实上报
    if (!(await docData(db, COLLECTIONS.csSession, id))) {
      console.error('[kf] enqueue failed (infra)', { id })
      alert('security', 'kfCallback', 'ENQUEUE_FAILED', {})
      return 'failed'
    }
    // 撞确定性 _id＝该顾客已有会话 doc：pending/active/escalated 不动（不 clobber·坐席已认领的不被重置·根因#1）；
    // **closed 则重开**（closed→pending·声明流转 cs.spec.ts·原子：非 closed 时 moved=false 天然不 clobber）——
    // 否则老客二次点「找人工」会被此撞 id 静默吞、永进不了队列。
    // createdAt 刷新＝重新排队（FIFO 队尾）+ getThread 消息流从重开起算（不翻旧会话历史）。
    // qc/qcSampledAt 一并**真删字段**（patch 成 `qc: null` 有语义 bug）：conversations.ts 的
    // saveQcMark/listQcSampled 用 DB 层 CAS `_.exists(false)` 判「未评过」——该条件要求字段真缺失，patch 成
    // null 只是把值改成 null、字段仍「存在」，_.exists(false) 永远判「已评过」→ 重开后 saveQcMark 永远 409
    // ALREADY_MARKED、listQcSampled(onlyPending) 也漏收（sampleQc 的内存 `!s.qc` 判断与此不一致：!null 为
    // true，能选中候选，DB CAS 却写不进——两套判断对同一字段的「清空」语义打架）。故用 `_.remove()`（真删
    // 键·对齐 $unset）才能让内存真值判断与 DB exists(false) 判断同一套语义。
    const _ = db.command
    const r = await transition(COLLECTIONS.csSession, id, ['closed'], 'pending', {
      agentId: null,
      claimedAt: null,
      createdAt: now,
      updatedAt: now,
      qc: _.remove(),
      qcSampledAt: _.remove(),
    }).catch(() => ({ moved: false })) /* best-effort：不反噬顾客回复 */
    queued = !!(r && (r as any).moved)
  }
  if (queued) await notifyOnlineAgents(db, id) // 推送·fail-soft（sendAgentCard 内吞错·不反噬入队）
  return queued ? 'queued' : 'already'
}

// 新会话入队 → 推「新会话待接」到在线坐席手机（fail-soft）。
// 在线坐席＝agentState.status='online'；其 wecomUserId 从 adminConfig 同 _id doc 取（坐席账号加的字段）。
// 全程 fail-soft（sendAgentCard 内吞错·此处 try/catch 兜查询）：推送失败绝不反噬顾客转人工入队（守卫 enqueue-push-fail-soft）。
async function notifyOnlineAgents(db: any, sessionId: string): Promise<void> {
  try {
    const st = await db
      .collection(COLLECTIONS.agentState)
      .where({ status: 'online' })
      .limit(50) // 坐席席位上限同账号扫描窗·有界读
      .get()
      .catch(() => ({ data: [] }))
    const ids = (st.data || []).map((a: any) => a._id).filter(Boolean)
    if (!ids.length) return
    // 键映射：超管坐席身份是 'admin'（checkKey 固定），但其账号 doc 是 'auth'——不映射则超管
    // 在线也查不到 wecomUserId＝只有超管值班时推送恒为空（escalate 推送读 'auth' 同口径）。
    const docIds = ids.map((id: string) => (id === 'admin' ? 'auth' : id))
    const cfg = await db
      .collection(COLLECTIONS.adminConfig)
      .where({ _id: db.command.in(docIds) })
      .limit(docIds.length)
      .get()
      .catch(() => ({ data: [] }))
    const touser = (cfg.data || []).map((d: any) => d.wecomUserId).filter(Boolean).map(String)
    await sendAgentCard(db, touser, {
      title: '新会话待接',
      description: '有顾客转入人工客服，请及时到工作台接待。',
      url: AGENT_DESK_URL + '?session=' + sessionId,
    })
  } catch {
    /* fail-soft：推送不反噬转人工入队 */
  }
}
