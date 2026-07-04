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

/**
 * 游标分页查询。filter=固定条件（如 {_openid}＝属主隔离），cursorField=排序字段。
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
  const f: Record<string, unknown> = { ...filter }
  if (cursor != null) f[cursorField] = db.command.lt(cursor)
  const res = await db
    .collection(collName)
    .where(f)
    .orderBy(cursorField, 'desc')
    .limit(limit + 1)
    .get()
  const rows: any[] = (res && res.data) || []
  const hasMore = rows.length > limit
  const list = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore && list.length ? list[list.length - 1][cursorField] : null
  return { list, nextCursor, hasMore }
}
