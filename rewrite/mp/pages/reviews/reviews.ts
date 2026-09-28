// 商品评价列表：首页汇总头（均分/分布/标签 Top5·首页返回后前端缓存）+ 游标分页。
import { tapHaptic } from '../../lib/haptics'
import { getReviews } from '../../api/reviews'
import { hiddenByTag, mapReviews, mapSummary, type ReviewVM, type SummaryVM } from '../../lib/mapReviews'
import { keyDown, keyUp } from '../../lib/keyFx'

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    list: [] as ReviewVM[],
    summary: null as SummaryVM | null,
    loading: true,
    loadFailed: false, // 失败≠空态（根因#14·守卫 rw-mp-list-loadfailed-state）：与「还没有评价」分治
    hasMore: false,
    cursor: null as unknown,
    title: '商品评价', // 顶栏页名：详情页带来商品名时显示「商品名 · 评价」
    tag: '', // 标签筛选（设计稿 A3）：当前选中的标签，空＝全部
    hidden: [] as boolean[], // 与 list 同下标：该行不带所选标签就藏
    shown: 0, // 筛选后露出的条数（空筛选态用）
    notFound: false, // 云端回 NO_PRODUCT（缺/坏商品号）：「找不到这个商品」，不当网络失败
    paging: false, // 触底翻页在途：底部像素 loader 行 + 防快速多次触底并发请求各自 append 造成重复行
  },
  productId: '',
  _seq: 0, // reload 代次（同 aftersales/order-list）：onLoad + 重试 + 触底翻页并发时丢弃过期回包
  onLoad(query: Record<string, string | undefined>) {
    this.productId = String(query.productId || '')
    let name = query.name || ''
    try {
      name = decodeURIComponent(name) // 各基础库对 query 是否已解码不一；名字含 % 时二次解码会抛错，失败就用原串
    } catch {
      // 刻意静默：只影响顶栏页名
    }
    if (name) this.setData({ title: name + ' · 评价' })
    void this.reload()
  },
  async reload() {
    const seq = ++this._seq
    const r = await getReviews(this.productId)
    if (seq !== this._seq) return // 过期回包（被更晚 reload 取代）：丢弃
    // 失败≠空态（根因#14）：失败不覆盖已有列表；一无所有时落 loadFailed 给重试，不与「还没有评价」混同。
    if (!r.ok && r.error === 'NO_PRODUCT') {
      this.setData({ loading: false, loadFailed: false, notFound: true }) // 确定性的「没有」，重试也没用
      return
    }
    if (!r.ok) {
      this.setData({ loading: false, loadFailed: !this.data.list.length })
      if (this.data.list.length) wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
      return
    }
    const list = mapReviews(r.list)
    const hidden = hiddenByTag(list, this.data.tag)
    this.setData({
      loading: false,
      loadFailed: false,
      list,
      hidden,
      shown: hidden.filter((h) => !h).length,
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
    if (this.data.paging) return // 在途重复触底：直接丢弃（防重复 append）
    this.setData({ paging: true })
    const seq = this._seq // 捕获当前代次（翻页不 bump）：期间若发生 reload（_seq 递增）则本次 append 作废
    const r = await getReviews(this.productId, this.data.cursor)
    this.setData({ paging: false })
    if (seq !== this._seq) return // reload 已取代当前列表：丢弃·不错配游标
    if (!r.ok) {
      wx.showToast({ title: '加载失败，上拉重试', icon: 'none' }) // 翻页失败不静默（根因#14）
      return // 不覆盖已有
    }
    // 增量 setData（根因#7 规模）：翻页只把新增行按路径键 list[N] 追加，不整表重发已渲染卡（O(n²) 传输）。
    // list 仍留 data（wxml 绑定它·wx:key="index" 追加式只读安全，见 wxml 泄露防护注释）；仅 append 不整表重发。
    const patch: Record<string, unknown> = { cursor: r.nextCursor, hasMore: !!r.hasMore }
    const rows = mapReviews(r.list)
    const hid = hiddenByTag(rows, this.data.tag)
    let idx = this.data.list.length
    rows.forEach((rv, i) => {
      patch['list[' + idx + ']'] = rv
      patch['hidden[' + idx + ']'] = hid[i]
      idx++
    })
    patch.shown = this.data.shown + hid.filter((h) => !h).length
    this.setData(patch)
  },
  // 点标签只看带它的评价，再点一次放回全部（设计稿 a_revTag）
  onTag(e: WechatMiniprogram.TouchEvent) {
    const t = String(e.currentTarget.dataset.tag || '')
    const tag = this.data.tag === t ? '' : t
    const hidden = hiddenByTag(this.data.list, tag)
    this.setData({ tag, hidden, shown: hidden.filter((h) => !h).length })
    void this.fillTag()
  },
  // 接口不支持按标签拉列表：匹配不到一屏（8 条）就接着往下翻页补，最多 5 页，免得短列表滑不动、触不了底
  async fillTag() {
    for (let n = 0; n < 5 && this.data.tag && this.data.hasMore && this.data.shown < 8 && !this.data.paging; n++) await this.onReachBottom()
  },
  // 买家秀晒图·点开大图（当前图为焦点·同条评价全部图为轮播集）
  onPreviewPhoto(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.url || '')
    const urls = (e.currentTarget.dataset.urls as string[]) || []
    if (url && urls.length) wx.previewImage({ current: url, urls })
  },
})
