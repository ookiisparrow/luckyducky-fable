import { COLLECTIONS } from '@ldrw/shared'
import { alert } from '../../../kit'
import { menu, type MsgMenuContent } from './menus'
import { docData, dropKfState } from './store'

// ── 满意度评分（CSAT·会话后评分 1-5 + 可选备注·确定性菜单不靠生成）──
/** 评分气泡：5 档星级（点一下即评分·rate:1..5）。 */
export function rateMenu(): MsgMenuContent {
  return menu(
    '给本次服务打个分吧（点一下）👇',
    [
      { id: 'rate:5', content: '⭐⭐⭐⭐⭐ 非常满意' },
      { id: 'rate:4', content: '⭐⭐⭐⭐ 满意' },
      { id: 'rate:3', content: '⭐⭐⭐ 一般' },
      { id: 'rate:2', content: '⭐⭐ 不太满意' },
      { id: 'rate:1', content: '⭐ 很不满意' },
    ],
    '点星星即可，感谢你的反馈～'
  )
}

// 备注预设标签（可选·deterministic·避免自由文本进热路径）：值＝入库备注文案，'none'＝不补充（空备注）。
export const CSAT_REASONS: Record<string, string> = {
  resolved: '问题已解决',
  unresolved: '问题没解决',
  slow: '回复有点慢',
  attitude: '态度很好',
  none: '',
}

/** 评分后的「补充原因」气泡（可选备注·点一下即记·不补充也行）。 */
export function csatReasonMenu(): MsgMenuContent {
  return menu(
    '想补充点什么吗？（可选）',
    Object.entries(CSAT_REASONS).map(([k, v]) => ({ id: 'csatnote:' + k, content: v || '不补充了' })),
    '点一下就好，不补充也没关系～'
  )
}

/** 解析评分 menu_id（rate:1..5）→ 分数；非法返 null（route 据此分流·入库再 fail-closed 校验一次）。 */
export function parseRate(menuId: string): number | null {
  const m = /^rate:([1-5])$/.exec(String(menuId || ''))
  return m ? Number(m[1]) : null
}

// ── 满意度评分入库（CSAT）──
interface CsatInput {
  externalUserId: string
  openid: string | null
  score: number
  note?: string
}
/**
 * 记一条满意度评分。**不信前端·根因#3**：score 越界（非 1..5）一律 fail-closed 不入库——防伪造/脏分
 * 污染满意度均分。确定性 _id=`csat:<euid>:<createdAt>`；并在 kfState 记最近一条
 * （`csatlast:<euid>`）供「补充备注」菜单回写——只在 CSAT 交互时读写、不进每条消息热路径。返回 csat 文档 id。
 */
export async function recordCsat(db: any, input: CsatInput): Promise<string | null> {
  const score = Number(input.score)
  if (!(score >= 1 && score <= 5)) return null // 越界分不入库（fail-closed）
  const euid = String(input.externalUserId || '')
  if (!euid) return null
  const createdAt = Date.now()
  const id = 'csat:' + euid + ':' + createdAt
  // 评分写库失败不静默吞、不谎报成功（病根#14）：若两次 .set().catch(()=>{}) 后恒返回 id——写没成功
  // 也回 csatId＝假成功（getCsatReport 会漏这条·且调用方以为记上了）。故：评分主写失败→告警 + 返回 null
  // （调用方据 null 可知没记上）；指针（csatlast·仅供 attachCsatNote 找最近记录）写失败非致命，告警但评分已落。
  let wrote = true
  await db
    .collection(COLLECTIONS.csat)
    .doc(id)
    .set({
      data: {
        externalUserId: euid,
        openid: input.openid || null,
        score,
        note: String(input.note || '').slice(0, 200),
        createdAt,
      },
    })
    .catch(() => {
      wrote = false
    })
  if (!wrote) {
    alert('anomaly', 'recordCsat', 'CSAT_WRITE_FAIL', { euid })
    return null
  }
  await db
    .collection(COLLECTIONS.kfState)
    .doc('csatlast:' + euid)
    .set({ data: { csatId: id, at: createdAt } })
    .catch(() => {
      alert('anomaly', 'recordCsat', 'CSAT_POINTER_FAIL', { euid }) // 评分已落·仅备注指针失败·非致命
    })
  return id
}

/** 回写最近一条满意度的备注（点「补充原因」预设标签时·非热路径）。无最近记录则静默跳过。 */
export async function attachCsatNote(db: any, externalUserId: string, note: string): Promise<void> {
  const euid = String(externalUserId || '')
  if (!euid || !note) return
  const last = await docData(db, COLLECTIONS.kfState, 'csatlast:' + euid)
  const csatId = last && last.csatId
  if (!csatId) return
  await db
    .collection(COLLECTIONS.csat)
    .doc(csatId)
    .update({ data: { note: String(note).slice(0, 200) } })
    .catch(() => {
      alert('anomaly', 'attachCsatNote', 'CSAT_NOTE_FAIL', { euid })
    })
  await dropKfState(db, 'csatlast:' + euid)
}
