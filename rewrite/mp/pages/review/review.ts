// 写评价（M2 批12）：星级 + 预设标签多选 + 文字 + 匿名开关。闸门全在云端
// （本人已完成订单/商品在单内/一单一行一评——撞主键如实回「已评过」）。
import { submitReview } from '../../api/reviews'

const REV_TAGS = ['教程清晰', '很可爱', '适合新手', '包装用心', '物流快', '线材好'] // 承接旧线预设
const REV_LABEL = ['点星评分', '非常不满', '不满意', '一般', '满意', '非常满意']

Page({
  data: {
    name: '',
    rating: 0,
    ratingLabel: REV_LABEL[0],
    tags: REV_TAGS.map((t) => ({ t, on: false })),
    text: '',
    anon: false,
    busy: false,
    starIdx: [1, 2, 3, 4, 5],
  },
  orderId: '',
  lineId: '',
  onLoad(query: Record<string, string | undefined>) {
    this.orderId = String(query.orderId || '')
    this.lineId = String(query.lineId || '')
    this.setData({ name: decodeURIComponent(String(query.name || '')) })
  },
  onStar(e: WechatMiniprogram.TouchEvent) {
    const rating = Number(e.currentTarget.dataset.n)
    this.setData({ rating, ratingLabel: REV_LABEL[rating] || REV_LABEL[0] })
  },
  onTag(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i)
    const tags = this.data.tags.map((x, idx) => (idx === i ? { ...x, on: !x.on } : x))
    this.setData({ tags })
  },
  onText(e: WechatMiniprogram.TextareaInput) {
    this.setData({ text: e.detail.value })
  },
  onAnon() {
    this.setData({ anon: !this.data.anon })
  },
  async onSubmit() {
    if (this.data.busy) return
    if (!this.data.rating) {
      wx.showToast({ title: '先点星评个分', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const r = await submitReview(
      this.orderId,
      this.lineId,
      this.data.rating,
      this.data.text.trim(),
      this.data.tags.filter((x) => x.on).map((x) => x.t),
      this.data.anon
    )
    this.setData({ busy: false })
    if (r.ok) {
      wx.showToast({ title: '感谢你的评价', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    const e = String(r.error || '')
    const msg = e === 'REVIEWED' ? '这条已经评过了' : e === 'NOT_DONE' ? '订单完成后才能评价' : '提交没成功，稍后再试'
    wx.showToast({ title: msg, icon: 'none' })
  },
})
