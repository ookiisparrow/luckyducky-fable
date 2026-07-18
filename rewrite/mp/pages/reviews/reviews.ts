// 商品评价列表（M2 批12）：首页汇总头（均分/分布/标签 Top5·首页返回后前端缓存）+ 游标分页。
import { tapHaptic } from '../../lib/haptics'
import { getReviews } from '../../api/reviews'
import { mapReviews, mapSummary, type ReviewVM, type SummaryVM } from '../../lib/mapReviews'

Page({
  data: {
    list: [] as ReviewVM[],
    summary: null as SummaryVM | null,
    loading: true,
    loadFailed: false, // 失败≠空态（根因#14·守卫 rw-mp-list-loadfailed-state）：与「还没有评价」分治
    hasMore: false,
    cursor: null as unknown,
  },
  productId: '',
  loadingMore: false, // 触底翻页在途标记（P2·bug sweep R1 #10）：防快速多次触底并发请求各自 append 造成重复行
  onLoad(query: Record<string, string | undefined>) {
    this.productId = String(query.productId || '')
    void this.reload()
  },
  async reload() {
    const r = await getReviews(this.productId)
    // 失败≠空态（根因#14）：失败不覆盖已有列表；一无所有时落 loadFailed 给重试，不与「还没有评价」混同。
    if (!r.ok) {
      this.setData({ loading: false, loadFailed: !this.data.list.length })
      if (this.data.list.length) wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
      return
    }
    this.setData({
      loading: false,
      loadFailed: false,
      list: mapReviews(r.list),
      summary: mapSummary(r.summary), // 首页汇总·翻页不重算（前端缓存）
      cursor: r.nextCursor,
      hasMore: !!r.hasMore,
    })
  },
  onRetryLoad() {
    tapHaptic()
    this.setData({ loading: true, loadFailed: false })
    void this.reload()
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null) return
    if (this.loadingMore) return // 在途重复触底：直接丢弃（防重复 append）
    this.loadingMore = true
    const r = await getReviews(this.productId, this.data.cursor)
    this.loadingMore = false
    if (!r.ok) {
      wx.showToast({ title: '加载失败，上拉重试', icon: 'none' }) // 翻页失败不静默（根因#14）
      return // 不覆盖已有
    }
    // 增量 setData（根因#7 规模）：翻页只把新增行按路径键 list[N] 追加，不整表重发已渲染卡（O(n²) 传输）。
    // list 仍留 data（wxml 绑定它·wx:key="index" 追加式只读安全，见 wxml 泄露防护注释）；仅 append 不整表重发。
    const patch: Record<string, unknown> = { cursor: r.nextCursor, hasMore: !!r.hasMore }
    let idx = this.data.list.length
    for (const rv of mapReviews(r.list)) {
      patch['list[' + idx + ']'] = rv
      idx++
    }
    this.setData(patch)
  },
  // 买家秀晒图·点开大图（当前图为焦点·同条评价全部图为轮播集）
  onPreviewPhoto(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.url || '')
    const urls = (e.currentTarget.dataset.urls as string[]) || []
    if (url && urls.length) wx.previewImage({ current: url, urls })
  },
})
