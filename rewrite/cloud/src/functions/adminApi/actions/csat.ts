import { reply, type Ctx } from '../lib'
import { pageQuery } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// 客服满意度报表（后台360工作站 B4.3·admin 侧·只读）：聚合 csat 集合出 均分 + 1-5 分布 + 总数 + 有备注数。
// bounded（≤SCAN 条·样本近似·CSAT 量级远低于此·approx 标注）；越界分（守 csat-score-bounded 已挡入库）这里
// 再忽略一次防御。名以 get 起头：shouldAudit 跳 ^get（聚合无 PII·不留痕降噪）。
const SCAN = 1000

export async function getCsatReport({ db }: Ctx) {
  const r = await db.collection('csat').limit(SCAN).get().catch(() => ({ data: [] }))
  const rows = (r && r.data) || []
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let sum = 0
  let n = 0
  let withNote = 0
  for (const d of rows) {
    const s = Number(d.score)
    if (s >= 1 && s <= 5) {
      dist[s]++
      sum += s
      n++
      if (d.note) withNote++
    }
  }
  const avg = n ? Math.round((sum / n) * 100) / 100 : 0 // structure-ok 非金额：满意度均分(1-5)保留两位小数·与钱链无关
  return reply(200, { ok: true, total: n, avg, dist, withNote, approx: rows.length >= SCAN })
}

const ENTRIES_DEFAULT_LIMIT = 20 // 明细分页默认页大小（同订单/售后体量·bounded·根因#7）

// 满意度明细钻取（B6·后台360工作站·admin 侧·只读·cursor 分页）：供 Csat.vue 明细表 + 负评「查会话」跳转。
// csat 集合结构性无 agentId（recordCsat 从未写入·见 cs/kfCallback/dispatch.ts）——本 action 不产出/暗示坐席维度，
// 纯按时间窗 + 评分上限钻取。sessionKey 回 externalUserId：recordCsat 落库前必校验 `if (!euid) return null`，
// 故凡入库的 csat 记录一律带 externalUserId（现场核实·非猜测），可据此在 Conversations 页检索定位会话。
//
// [from,to) 含起不含止：
//   · to 走 pageQuery 原生 filter（`createdAt: _.lt(to)`）——desc 序下天然对续页自持（cursor.v 必 < to，
//     续页的隐式上界只会更紧，不会松·kit/paging.ts 复合游标机制的推论，无需页后修正）。
//   · from 走「页后过滤 + 截断」：pageQuery 的 `filter[cursorField]` 在续页会被游标覆盖（同字段无法原生
//     持续下限——见 kit/paging.ts `where({...filter, [cursorField]: beyond(cursor)})`），故 from 不能塞进
//     filter；改为页内过滤 `createdAt>=from`，一旦本页出现被过滤掉的行（即触到 from 边界)，说明再往后的
//     行只会更早、一律小于 from——直接砍 hasMore/nextCursor，不再继续翻页（避免把过老记录误判成「还有更多」）。
//   · maxScore：score 是 1-5 整数，桩/真 sdk 均无 `lte` 算子——用 `_.in([1..maxScore])` 原生过滤（score 非
//     cursorField，无覆盖问题，直接进 filter 即可，无需页后修正）。
export async function listCsatEntries({ db, data }: Ctx) {
  const d = data || {}
  const _ = db.command
  const filter: Record<string, unknown> = {}
  const toMs = Number(d.to)
  if (Number.isFinite(toMs)) filter.createdAt = _.lt(toMs)
  const maxScore = Number(d.maxScore)
  if (Number.isFinite(maxScore) && maxScore >= 1 && maxScore <= 5) {
    filter.score = _.in([1, 2, 3, 4, 5].filter((s) => s <= maxScore))
  }
  const paged = await pageQuery(db, COLLECTIONS.csat, filter, 'createdAt', d, ENTRIES_DEFAULT_LIMIT)
  let list = paged.list
  let hasMore = paged.hasMore
  let nextCursor = paged.nextCursor
  const fromMs = Number(d.from)
  if (Number.isFinite(fromMs)) {
    const kept = list.filter((r: any) => (Number(r.createdAt) || 0) >= fromMs)
    if (kept.length < list.length) {
      // 本页已触到 from 下界——后续页只会更早，全部落在窗口外，就此收口不再续页
      hasMore = false
      nextCursor = null
    }
    list = kept
  }
  const entries = list.map((r: any) => ({
    id: String(r._id || ''), // 行级唯一键（确定性 _id·recordCsat 现场）——供 Csat.vue「加载更多」按 id 去重，同 Orders/Refunds/Conversations 范式
    at: Number(r.createdAt) || 0,
    score: Number(r.score) || 0,
    note: String(r.note || ''),
    sessionKey: String(r.externalUserId || ''),
  }))
  return reply(200, { ok: true, entries, nextCursor, hasMore })
}
