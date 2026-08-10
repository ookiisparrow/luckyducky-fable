import { COLLECTIONS } from '@ldrw/shared'
import { getDb, isServerCall, ok, notifyAlert } from '../../kit'

// 新反馈通知（流水线 P3·意见箱铃铛）：定时扫 feedback 集合新增 → 推企微群（owner 手机实时收）。
// 语义：反馈是低频动作, 每天 1 次轮询足够；推通知提醒人工去开意见箱（人工筛选是安全闸, AI 不自动读反馈原文）。
// 游标 = feedbackNotifyCursor/doc('state').lastScanAt；先写游标再推送（防重扫重复推）。
// 只读业务数据（feedback）+ 写自身游标；fail-soft：任何失败不反噬。
// 静音：adminConfig/settings.alertEvents['NEW_FEEDBACK']=false（沿用 notifyAlert 静音机制）。
// 安全：反馈内容仅截取前 80 字进通知 ctx（原文在库里, 人工在控制台/后台查看）。

const SCAN_WINDOW_MS = 48 * 60 * 60 * 1000 // 兜底窗口 48h（首次运行/游标丢失时用）
const MAX_SCAN = 100 // 单轮最多通知条数（防异常突增刷屏）

export const main = async () => {
  if (!isServerCall()) return ok({ skipped: true })
  const db = getDb()
  const _ = db.command

  // 读游标（上次扫描时间）
  let cursor = Date.now() - SCAN_WINDOW_MS
  try {
    const c = await db.collection(COLLECTIONS.feedbackNotifyCursor).doc('state').get()
    const data = (c && (c as any).data) || {}
    if (data.lastScanAt) cursor = data.lastScanAt
  } catch {
    /* 首次运行或集合不存在: 用兜底窗口 */
  }

  // 扫新增反馈
  const q = await db
    .collection(COLLECTIONS.feedback)
    .where({ createdAt: _.gt(cursor) })
    .orderBy('createdAt', 'asc')
    .limit(MAX_SCAN)
    .get()
    .catch(() => null)
  const rows = (q && (q as any).data) || []
  const now = Date.now()

  // 先更新游标（防重复推送）
  try {
    await db
      .collection(COLLECTIONS.feedbackNotifyCursor)
      .doc('state')
      .set({ data: { lastScanAt: now } })
  } catch {
    try {
      await db.createCollection(COLLECTIONS.feedbackNotifyCursor)
      await db.collection(COLLECTIONS.feedbackNotifyCursor).doc('state').set({ data: { lastScanAt: now } })
    } catch {
      /* fail-soft: 游标写失败则下次可能重扫, 但通知有去重价值 > 静默 */
    }
  }

  if (rows.length > 0) {
    const cats: Record<string, number> = {}
    for (const r of rows) cats[r.category] = (cats[r.category] || 0) + 1
    const latest = rows[rows.length - 1]
    await notifyAlert('anomaly', 'feedbackNotify', 'NEW_FEEDBACK', {
      count: rows.length,
      cats,
      latestCat: latest.category,
      latestContent: String(latest.content || '').slice(0, 80),
    })
  }

  return ok({ scanned: rows.length, newFeedback: rows.length })
}
