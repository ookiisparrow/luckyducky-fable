// 商品评价列表（M2 批12）：首页汇总头（均分/分布/标签 Top5·首页返回后前端缓存）+ 游标分页。
import { getReviews } from '../../api/reviews'
import { mapReviews, mapSummary, type ReviewVM, type SummaryVM } from '../../lib/mapReviews'

Page({
  data: {
    list: [] as ReviewVM[],
    summary: null as SummaryVM | null,
    loading: true,
    hasMore: false,
    cursor: null as unknown,
  },
  productId: '',
  onLoad(query: Record<string, string | undefined>) {
    this.productId = String(query.productId || '')
    void this.reload()
  },
  async reload() {
    const r = await getReviews(this.productId)
    this.setData({
      loading: false,
      list: r.ok ? mapReviews(r.list) : [],
      summary: r.ok ? mapSummary(r.summary) : null, // 首页汇总·翻页不重算（前端缓存）
      cursor: r.ok ? r.nextCursor : null,
      hasMore: !!(r.ok && r.hasMore),
    })
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null) return
    const r = await getReviews(this.productId, this.data.cursor)
    if (!r.ok) return // 翻页失败不覆盖已有
    this.setData({ list: [...this.data.list, ...mapReviews(r.list)], cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
})
