import { reply, type Ctx } from '../lib'

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
