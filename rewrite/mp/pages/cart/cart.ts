// 购物车页（M2 批4·批5 接结算·重设计对齐设计「待选区」）：
//   待选区＝已加购行（勾选/加减/删除/合计），下方＝推荐商品圆加号加购（设计 options 语义·真数据）。
//   核心逻辑（lib/cart 单源·结算走选中项）零改；本批只加「推荐加购/开详情」两个读侧 handler。
import { tapHaptic } from '../../lib/haptics'
import * as cart from '../../lib/cart'
import { prepareFromCart } from '../../lib/checkout'
import { getAllProducts } from '../../lib/catalog'
import { mapProducts, type ProductVM } from '../../lib/mapHome'

let allRaw: Record<string, any>[] = [] // 全商品原档（算推荐+加购取价·onLoad 拉一次）

Page({
  data: {
    items: [] as ReturnType<typeof cart.getItems>,
    allSelected: false,
    selectedCount: 0,
    totalLabel: '¥0.00',
    recs: [] as ProductVM[], // 未在袋中的推荐（设计「下方选品」）
  },
  ready: false, // 首建实例 onLoad 首拉完成前的 onShow 抢跑标记（P3·bug sweep R1 #11）：微信 onLoad→onShow 相邻触发，
  // onLoad 的 await 未落地时 onShow 已跑，allRaw 还是空数组、二者并发各自 setData 互相踩踏。
  async onLoad() {
    allRaw = (await getAllProducts()) || [] // 复用首页缓存·热路径零云调用（miss 则兜底重拉一次）
    this.refresh() // 首拉落地（refresh 内部含 setActive('cart')）
    this.ready = true
  },
  onShow() {
    if (!this.ready) return // 首建实例抢跑：onLoad 首拉还没完成，交给它自己的 refresh 收尾，这次 onShow 不重复刷新
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('cart')
    this.refresh()
  },
  refresh() {
    // 展示 cover 用 allRaw 最新值覆盖（批B 图片链提速回归：持久化 cover 是 2h 时效临时址，隔天过期挂图）；
    // 存量 cart.getItems() 仍是持久化真值，只在这层视图组装时覆盖展示字段，不改 storage 契约。
    const items = cart.getItems().map((it) => ({ ...it, cover: cart.freshCover(it, allRaw) }))
    const inCart = new Set(items.map((it) => it.id))
    this.setData({
      items,
      allSelected: cart.allSelected(),
      selectedCount: cart.selectedCount(),
      totalLabel: cart.selectedTotalLabel(),
      recs: mapProducts(allRaw.filter((p) => !inCart.has(String(p.id || p._id || '')))).slice(0, 6), // 排除已在袋中
    })
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('cart') // 角标随动
  },
  onToggle(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.toggle(id, sku)
    this.refresh()
  },
  onToggleAll() {
    cart.toggleAll()
    this.refresh()
  },
  onInc(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.bump(id, 1, sku) // 相对增·读内存最新 qty（不用渲染层 data-qty）·连点不丢增量
    this.refresh()
  },
  onDec(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.bump(id, -1, sku) // 相对减·钳位 ≥1（减到 1 再减不动·删行走「删除」→ 落回下方推荐）
    this.refresh()
  },
  onRemove(e: WechatMiniprogram.TouchEvent) {
    const { id, sku } = e.currentTarget.dataset as { id: string; sku: string }
    cart.remove(id, sku)
    this.refresh() // 移出袋→若是已知商品会重回下方推荐（设计 qty→0 落 options 语义）
  },
  onAddRec(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    const p = allRaw.find((x) => String(x.id || x._id || '') === id)
    if (!p) return
    cart.add({ id, name: String(p.name || ''), tag: String(p.tag || ''), price: Number(p.price), was: typeof p.was === 'number' ? p.was : undefined, cover: String(p.cover || '') })
    this.refresh()
    wx.showToast({ title: '已加入购物袋', icon: 'success' })
  },
  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },
  onCheckout() {
    if (!this.data.selectedCount) {
      wx.showToast({ title: '先勾选要买的宝贝', icon: 'none' })
      return
    }
    tapHaptic()
    prepareFromCart() // 选中项快照进草稿（fromCart·提交成功按实际数量扣车）
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },
})
