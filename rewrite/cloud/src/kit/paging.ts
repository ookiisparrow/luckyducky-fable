import type { CollectionName } from '@ldrw/shared'

// 统一分页协议（根因#7：列表读一律 cursor/limit 契约，禁裸全量/固定条数）。
// 游标式：按排序字段值翻页，多查一条判 hasMore；无参=首页默认 limit（兼容旧调用）。
const ABS_MAX = 200

export interface PageReq {
  cursor?: unknown
  limit?: unknown
}
export interface Paged {
  list: any[]
  nextCursor: unknown
  hasMore: boolean
}

/** 解析分页入参（无参=首页默认 limit；limit 钳 [1, 200]，非法回默认；空游标归一 null）。 */
export function pageParams(req: PageReq | undefined, defaultLimit = 20) {
  const r: any = req || {}
  const limit = Math.min(ABS_MAX, Math.max(1, Number(r.limit) || defaultLimit))
  const cursor = r.cursor === undefined || r.cursor === null || r.cursor === '' ? null : r.cursor
  return { limit, cursor }
}

/** 复合游标形状（根因#7 tiebreaker）：v=cursorField 值，id=该行 _id（打破同值平局）。 */
interface CompoundCursor {
  v: unknown
  id: unknown
}

function isCompoundCursor(c: unknown): c is CompoundCursor {
  return !!c && typeof c === 'object' && 'v' in (c as any) && 'id' in (c as any)
}

/**
 * 游标分页查询。filter=固定条件（如 {_openid}＝属主隔离），cursorField=排序字段。
 * 复合游标 + `_id` tiebreaker（根因#7 单一时间戳游标丢数）：跨页边界 cursorField 同值的多条记录
 * 单靠 `lt(cursor)` 会被永久跳过（同值记录落在游标两侧、既不在「之前」也不在「之后」的判定里）。
 * 故翻页排序与游标判定都带上 `_id` 第二列——`v` 严格小 或（`v` 相等 且 `_id` 严格小）。
 * 向后兼容：收到旧形态纯值游标（非 {v,id} 对象，如在途翻页会话）时按旧 `lt(cursor)` 语义处理。
 *
 * 实现刻意不用 `db.command.and()/or()` 嵌套（[靠人:#8 验证样本失真]：全仓没有别处用这个组合，
 * 只有本仓自制测试桩验证过，从未打过真实云数据库，构建过≠真机能用）——故用全仓已在
 * 生产广泛验证的单字段 `lt`/`eq`（见 timers/throttle/refunds 等既有大量用例）拆两条独立查询各取
 * `limit+1` 后内存合并：tie 段（`cursorField===v` 且 `_id<id`，按 `_id desc`）与 lt 段
 * （`cursorField<v`，已按 `cursorField desc,_id desc` 排好）互斥且 tie 段值天然「更大」，
 * 合并顺序＝tie 段在前、lt 段在后，再统一裁到 `limit+1`，与「单条复合条件」语义等价。
 * 排序字段就是 `_id` 时不走这两条：v 和 id 是同一列，对象字面量里两个 `_id` 键会互相覆盖，
 * 拼起来不去重，尾页 hasMore 会报错。这种情况只发一条 `beyond(_id)`。
 * filter 自带 `_id`（admin listOrders 的精确单号，refund:manage 专员只能靠它查单）时，游标的 `_id` 界
 * 不能写进 where——同名键后写的赢，会把 filter 的 `_id` 覆盖掉，伪造游标就能翻出同值的别家单（#400-11）。
 * 两条都得成立：filter 的 `_id` 留在 where，游标的 `_id` 界改在内存判（不拼 and，理由同上）。
 */
export async function pageQuery(
  db: any,
  collName: CollectionName,
  filter: Record<string, unknown>,
  cursorField: string,
  req: PageReq | undefined,
  defaultLimit = 20,
  order: 'asc' | 'desc' = 'desc' // 根因#7：可选排序方向，默认 desc；
  // 'asc' 供 FIFO 队列（listQueue）复用——比较方向随之整体翻转，镜像 desc 分支写（见下）。
): Promise<Paged> {
  const { limit, cursor } = pageParams(req, defaultLimit)
  const asc = order === 'asc'
  const _ = db.command
  const beyond = (v: unknown) => (asc ? _.gt(v) : _.lt(v)) // asc 续页取「更大」、desc 续页取「更小」——同一比较方向套用在 tie 段（_id）与 span 段（cursorField）
  // ponytail: 精确 _id 最多一行，内存判无截断问题；filter._id 若改成 _.in 之类多值条件，limit 截断可能漏行（不越权），届时再上真 and
  const pinned = Object.prototype.hasOwnProperty.call(filter, '_id')
  const idBound = (id: unknown) => (pinned ? {} : { _id: beyond(id) })
  const pastId = (id: unknown) => (r: any) => !pinned || (asc ? r._id > (id as any) : r._id < (id as any))
  let rows: any[]
  if (cursor != null && cursorField === '_id') {
    // 值与 id 同一列，单条 beyond(_id)；双查询同名键会互相覆盖（见上）。旧纯值游标本身就是 _id。
    const id = isCompoundCursor(cursor) ? cursor.id : cursor
    const res = await db.collection(collName).where({ ...filter, ...idBound(id) }).orderBy('_id', order).limit(limit + 1).get()
    rows = ((res && res.data) || []).filter(pastId(id))
  } else if (isCompoundCursor(cursor)) {
    const [tieRes, spanRes] = await Promise.all([
      db.collection(collName).where({ ...filter, [cursorField]: cursor.v, ...idBound(cursor.id) }).orderBy('_id', order).limit(limit + 1).get(),
      db.collection(collName).where({ ...filter, [cursorField]: beyond(cursor.v) }).orderBy(cursorField, order).orderBy('_id', order).limit(limit + 1).get(),
    ])
    rows = [...((tieRes && tieRes.data) || []).filter(pastId(cursor.id)), ...((spanRes && spanRes.data) || [])].slice(0, limit + 1)
  } else if (cursor != null) {
    const res = await db.collection(collName).where({ ...filter, [cursorField]: beyond(cursor) }).orderBy(cursorField, order).orderBy('_id', order).limit(limit + 1).get() // 向后兼容：旧纯值游标
    rows = (res && res.data) || []
  } else {
    const res = await db.collection(collName).where({ ...filter }).orderBy(cursorField, order).orderBy('_id', order).limit(limit + 1).get()
    rows = (res && res.data) || []
  }
  const hasMore = rows.length > limit
  const list = hasMore ? rows.slice(0, limit) : rows
  const last = hasMore && list.length ? list[list.length - 1] : null
  const nextCursor: CompoundCursor | null = last ? { v: last[cursorField], id: last._id } : null
  return { list, nextCursor, hasMore }
}
