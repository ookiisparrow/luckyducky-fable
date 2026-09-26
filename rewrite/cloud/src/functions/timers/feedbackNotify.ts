import { COLLECTIONS } from '@ldrw/shared'
import { getDb, isServerCall, ok, notifyAlert, alert } from '../../kit'

// 新反馈通知（意见箱铃铛）：定时扫 feedback 集合新增 → 推企微群（owner 手机实时收）。
// 语义：反馈是低频动作, 每天 1 次轮询足够；推通知提醒人工去开意见箱（人工筛选是安全闸, AI 不自动读反馈原文）。
// 游标 = feedbackNotifyCursor/doc('state').lastScanAt，只代表「已纳入通知的最后一条」的 createdAt。
// 读失败、空页不动游标；触顶只停在本页最后一条，不用 Date.now()——否则下轮会跳过从没提醒过的意见。
// 先通知再写游标：写失败最多重推一次，不把没通知到的标成已扫。
// 只读业务数据（feedback）+ 写自身游标；fail-soft：任何失败不反噬（返回成功，但游标不前移）。
// 静音：adminConfig/settings.alertEvents['NEW_FEEDBACK']=false（沿用 notifyAlert 静音机制）。
// 安全：反馈内容仅截取前 80 字进通知 ctx（原文在库里, 人工在控制台/后台查看）。
// ponytail: 同一毫秒超过 MAX_SCAN 且被 limit 从中截断时，同毫秒没进本页的会被 gt 漏掉；
// 真意见箱到不了这个密度。要补就用 createdAt+_id 复合游标，别改回墙钟水位。

const SCAN_WINDOW_MS = 48 * 60 * 60 * 1000 // 兜底窗口 48h（首次运行/游标丢失时用）
const MAX_SCAN = 100 // 单轮最多通知条数（防异常突增刷屏）

async function saveCursor(db: any, lastScanAt: number): Promise<boolean> {
  const write = () => db.collection(COLLECTIONS.feedbackNotifyCursor).doc('state').set({ data: { lastScanAt } })
  try {
    await write()
    return true
  } catch {
    try {
      await db.createCollection(COLLECTIONS.feedbackNotifyCursor)
      await write()
      return true
    } catch {
      /* 写失败则下轮重扫同一批；重推一次，好过把没通知到的标成已扫 */
      return false
    }
  }
}

export const main = async () => {
  if (!isServerCall()) return ok({ skipped: true })
  const db = getDb()
  const _ = db.command

  // 读游标（上次已通知到的提交时间）。没有游标才用 48h 兜底，读失败不把「现在」写成已扫。
  let cursor = Date.now() - SCAN_WINDOW_MS
  try {
    const c = await db.collection(COLLECTIONS.feedbackNotifyCursor).doc('state').get()
    const data = (c && (c as any).data) || {}
    if (typeof data.lastScanAt === 'number' && Number.isFinite(data.lastScanAt)) cursor = data.lastScanAt
  } catch {
    /* 首次运行或集合不存在: 用兜底窗口 */
  }

  let rows: any[]
  try {
    const q = await db
      .collection(COLLECTIONS.feedback)
      .where({ createdAt: _.gt(cursor) })
      .orderBy('createdAt', 'asc')
      .limit(MAX_SCAN)
      .get()
    rows = (q && (q as any).data) || []
  } catch {
    alert('anomaly', 'feedbackNotify', 'SCAN_FAILED', {})
    return ok({ scanned: 0, newFeedback: 0, cursorAdvanced: false, capped: false })
  }

  // 空页只说明查询当时没看见。推到 Date.now() 会漏掉查询空隙里刚写入的意见。
  if (rows.length === 0) return ok({ scanned: 0, newFeedback: 0, cursorAdvanced: false, capped: false })

  const latest = rows[rows.length - 1]
  const watermark = Number(latest && latest.createdAt)
  if (!Number.isFinite(watermark)) {
    alert('anomaly', 'feedbackNotify', 'SCAN_FAILED', { reason: 'bad-createdAt' })
    return ok({ scanned: rows.length, newFeedback: 0, cursorAdvanced: false, capped: rows.length >= MAX_SCAN })
  }

  const capped = rows.length >= MAX_SCAN
  const cats: Record<string, number> = {}
  for (const r of rows) cats[r.category] = (cats[r.category] || 0) + 1
  await notifyAlert('anomaly', 'feedbackNotify', 'NEW_FEEDBACK', {
    count: rows.length,
    cats,
    latestCat: latest.category,
    latestContent: String(latest.content || '').slice(0, 80),
  })

  // 触顶时水位停在本页最后一条：下轮 gt(watermark) 接上尾巴，不跳到现在。
  const cursorAdvanced = await saveCursor(db, watermark)
  return ok({ scanned: rows.length, newFeedback: rows.length, cursorAdvanced, capped })
}
