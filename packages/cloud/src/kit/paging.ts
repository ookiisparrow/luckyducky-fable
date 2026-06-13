// 统一分页协议（根因账本 #7：列表固定 limit，规模即把旧数据挤出工作台）。
// 游标式：按排序字段值翻页，多查一条判 hasMore。**后端先行兼容无参**：无 cursor/limit
// 即返回首页（旧前端读 .list 照常），前端用 nextCursor 渐进取全量。
// 注：同 cursorField 值并列时可能跨页错位（毫秒时间戳罕见），沿用各表现有 orderBy 语义。
const ABS_MAX = 200

export interface PageReq {
  cursor?: any
  limit?: any
}
export interface Paged {
  list: any[]
  nextCursor: any
  hasMore: boolean
}

/** 解析分页入参（无参=首页默认 limit；limit 钳 [1, 200]，非法回默认）。 */
export function pageParams(req: PageReq | undefined, defaultLimit = 20) {
  const r: any = req || {}
  const limit = Math.min(ABS_MAX, Math.max(1, Number(r.limit) || defaultLimit))
  const cursor = r.cursor === undefined || r.cursor === null || r.cursor === '' ? null : r.cursor
  return { limit, cursor }
}

/**
 * 游标分页查询。filter=固定条件（如 {_openid}），cursorField=排序字段（createdAt/appliedAt）。
 * 用法：const paged = await pageQuery(db, 'orders', { _openid: OPENID }, 'createdAt', event, 100)
 */
export async function pageQuery(
  db: any,
  collName: string,
  filter: Record<string, any>,
  cursorField: string,
  req: PageReq | undefined,
  defaultLimit = 20
): Promise<Paged> {
  const { limit, cursor } = pageParams(req, defaultLimit)
  const f: Record<string, any> = { ...filter }
  if (cursor != null) f[cursorField] = db.command.lt(cursor)
  const res = await db
    .collection(collName)
    .where(f)
    .orderBy(cursorField, 'desc')
    .limit(limit + 1) // 多查一条判 hasMore
    .get()
  const rows: any[] = (res && res.data) || []
  const hasMore = rows.length > limit
  const list = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore && list.length ? list[list.length - 1][cursorField] : null
  return { list, nextCursor, hasMore }
}
