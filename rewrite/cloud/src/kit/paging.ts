// 统一分页协议（设计约束#7：列表读一律 cursor/limit 契约，禁裸全量/固定条数）。
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

/** 复合游标形状（P2·根因#7 tiebreaker 修复）：v=cursorField 值，id=该行 _id（打破同值平局）。 */
export interface CompoundCursor {
  v: unknown
  id: unknown
}

function isCompoundCursor(c: unknown): c is CompoundCursor {
  return !!c && typeof c === 'object' && 'v' in (c as any) && 'id' in (c as any)
}

/**
 * 游标分页查询。filter=固定条件（如 {_openid}＝属主隔离），cursorField=排序字段。
 * 复合游标 + `_id` tiebreaker（P2·根因#7 单一时间戳游标丢数）：跨页边界 cursorField 同值的多条记录
 * 单靠 `lt(cursor)` 会被永久跳过（同值记录落在游标两侧、既不在「之前」也不在「之后」的判定里）。
 * 修：翻页排序与游标判定都带上 `_id` 第二列——`v` 严格小 或（`v` 相等 且 `_id` 严格小）。
 * 向后兼容：收到旧形态纯值游标（非 {v,id} 对象，如在途翻页会话）时按旧 `lt(cursor)` 语义处理。
 *
 * 实现刻意不用 `db.command.and()/or()` 嵌套（P2 复核·[靠人#8 验证样本失真]：全仓 grep 显示这会是该
 * 组合的首次使用，只被本仓自制测试桩验证过，从未打过真实云数据库，构建过≠真机能用）——改用全仓已在
 * 生产广泛验证的单字段 `lt`/`eq`（见 timers/throttle/refunds 等既有大量用例）拆两条独立查询各取
 * `limit+1` 后内存合并：tie 段（`cursorField===v` 且 `_id<id`，按 `_id desc`）与 lt 段
 * （`cursorField<v`，已按 `cursorField desc,_id desc` 排好）互斥且 tie 段值天然「更大」，
 * 合并顺序＝tie 段在前、lt 段在后，再统一裁到 `limit+1`，与「单条复合条件」语义等价。
 */
export async function pageQuery(
  db: any,
  collName: string,
  filter: Record<string, unknown>,
  cursorField: string,
  req: PageReq | undefined,
  defaultLimit = 20
): Promise<Paged> {
  const { limit, cursor } = pageParams(req, defaultLimit)
  const _ = db.command
  let rows: any[]
  if (isCompoundCursor(cursor)) {
    const [tieRes, ltRes] = await Promise.all([
      db.collection(collName).where({ ...filter, [cursorField]: cursor.v, _id: _.lt(cursor.id) }).orderBy('_id', 'desc').limit(limit + 1).get(),
      db.collection(collName).where({ ...filter, [cursorField]: _.lt(cursor.v) }).orderBy(cursorField, 'desc').orderBy('_id', 'desc').limit(limit + 1).get(),
    ])
    rows = [...((tieRes && tieRes.data) || []), ...((ltRes && ltRes.data) || [])].slice(0, limit + 1)
  } else if (cursor != null) {
    const res = await db.collection(collName).where({ ...filter, [cursorField]: _.lt(cursor) }).orderBy(cursorField, 'desc').orderBy('_id', 'desc').limit(limit + 1).get() // 向后兼容：旧纯值游标
    rows = (res && res.data) || []
  } else {
    const res = await db.collection(collName).where({ ...filter }).orderBy(cursorField, 'desc').orderBy('_id', 'desc').limit(limit + 1).get()
    rows = (res && res.data) || []
  }
  const hasMore = rows.length > limit
  const list = hasMore ? rows.slice(0, limit) : rows
  const last = hasMore && list.length ? list[list.length - 1] : null
  const nextCursor: CompoundCursor | null = last ? { v: last[cursorField], id: last._id } : null
  return { list, nextCursor, hasMore }
}
