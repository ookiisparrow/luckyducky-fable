import { COLLECTIONS } from '@ldrw/shared'
import { alert } from '../../../kit'
import { docData, dropKfState } from './store'

// ── 一批消息处理：去重认领 + 防吞单 ──

/**
 * 原子认领去重（确定性 _id 撞号即已处理过·根因#1 幂等）。三态（根因#8）：
 * - `first`：本次认领成功（首见）→ 处理；
 * - `duplicate`：撞号·真重复（已认领过）→ 跳过安全；
 * - `error`：add 因基建失败（DB 权限/集合缺/瞬时）→ **绝不可当重复静默跳过**（会无回复、无告警、不重试＝永久吞消息）。
 *
 * 若把 add 的任何异常都返 false（=已处理·跳过），基建错也被当重复 → 真实客服消息静默丢失。故 add 失败后
 * **回查该 seen 文档是否真存在**：存在＝真撞号（duplicate）；不存在＝add 没写进去（基建错·error），消息未认领须重试。
 */
type ClaimResult = 'first' | 'duplicate' | 'error'
export async function firstSeen(db: any, msgid: string): Promise<ClaimResult> {
  try {
    await db.collection(COLLECTIONS.kfState).add({ data: { _id: 'seen:' + msgid, at: Date.now() } })
    return 'first'
  } catch {
    return (await docData(db, COLLECTIONS.kfState, 'seen:' + msgid)) ? 'duplicate' : 'error'
  }
}

/**
 * 逐条处理一批客服消息（防吞单）：① 原子认领去重（撞号跳过）② 每条包 try/catch——
 * 单条失败**不中断整批**（否则 handleMessage 抛错会 unwind 整个 sync 循环：游标不推进 +
 * 已认领的消息永久跳过 = 静默吞掉顾客消息）；失败时 **撤回认领 + alert HANDLE_FAILED**。
 * 返回 true＝本批没处理完（有失败，或到了 deadline 停下）。调用方据此**保留旧游标**下次重拉：成功项 seen 去重、
 * 失败项和没轮到的重试——顾客消息至少处理一次。（抛错路径均为瞬时：DB/网络；send errcode 不抛·已自 alert。）
 */
export async function processKfBatch(
  db: any,
  msgs: any[],
  handleOne: (msg: any) => Promise<void>,
  deadline = Infinity
): Promise<boolean> {
  let anyFailed = false
  for (const msg of msgs || []) {
    // 函数超时会在处理中途硬杀，被杀那条已认领、下次按重复跳过＝吞消息：到点就停，剩下的不认领
    if (Date.now() > deadline) return true
    const msgid = String((msg && msg.msgid) || '')
    if (msgid) {
      const claim = await firstSeen(db, msgid)
      if (claim === 'duplicate') continue // 真重复·已处理过·跳过安全
      if (claim === 'error') {
        // 认领基础设施错误（DB 权限/集合缺/瞬时）：告警 + 本批失败 → 调用方保留旧游标重试，绝不静默跳过吞消息
        console.error('[kf] claim failed (infra)', { msgid })
        alert('security', 'kfCallback', 'CLAIM_FAILED', {})
        anyFailed = true
        continue // 未认领成功就不处理，留待下次重拉重认领（避免无认领下重复副作用）
      }
    }
    try {
      await handleOne(msg)
    } catch (e) {
      console.error('[kf] handle threw', { msgid }, String(e))
      alert('security', 'kfCallback', 'HANDLE_FAILED', {})
      // 撤回认领 → 不永久吞单（配合调用方保留旧游标重试）
      if (msgid) await dropKfState(db, 'seen:' + msgid)
      anyFailed = true
    }
  }
  return anyFailed
}
