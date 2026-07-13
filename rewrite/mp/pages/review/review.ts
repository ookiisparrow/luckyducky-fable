// 写评价（M2 批12）：星级 + 预设标签多选 + 文字 + 匿名开关。闸门全在云端
// （本人已完成订单/商品在单内/一单一行一评——撞主键如实回「已评过」）。
import { tapHaptic } from '../../lib/haptics'
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
    photos: [] as string[], // 已上传云存储 cloud:// fileID（picker 直接以 <image src=cloud://> 显缩略）
    uploading: false,
    maxPhotos: 9,
  },
  orderId: '',
  lineId: '',
  backTimer: null as ReturnType<typeof setTimeout> | null,
  unloaded: false, // 提交在途页面已退出标记（P2·bug sweep R1 #9）：提交本身已达服务端，退页后回包只是迟到副作用，不补偿
  onUnload() {
    this.unloaded = true
    if (this.backTimer) clearTimeout(this.backTimer) // 延时返回坞清理（守卫 rw-mp-navback-timer-cleaned）
  },
  onLoad(query: Record<string, string | undefined>) {
    this.orderId = String(query.orderId || '')
    this.lineId = decodeURIComponent(String(query.lineId || '')) // 与 order.ts onWriteReview 的 encodeURIComponent 成对（同 name 往返约定）
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
  // 选图 + 传云存储：拿临时路径逐张传 cloud://（内容安全在云端提交时逐张校·fail-closed）；单张失败跳过不阻塞。
  async onAddPhotos() {
    if (this.data.uploading) return
    const left = this.data.maxPhotos - this.data.photos.length
    if (left <= 0) return
    let res: WechatMiniprogram.ChooseMediaSuccessCallbackResult
    try {
      res = await wx.chooseMedia({ count: left, mediaType: ['image'], sizeType: ['compressed'] })
    } catch {
      return // 用户取消
    }
    this.setData({ uploading: true })
    const ups: string[] = []
    for (const f of res.tempFiles) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `reviews/${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`,
          filePath: f.tempFilePath,
        })
        if (up.fileID) ups.push(up.fileID)
      } catch {
        /* 单张失败跳过 */
      }
    }
    if (this.unloaded) return // await 恢复点复核（同 onSubmit 范式·深审20260712 P3）：上传在途已退页——迟到回包不再 setData/toast
    this.setData({ photos: [...this.data.photos, ...ups].slice(0, this.data.maxPhotos), uploading: false })
    if (ups.length < res.tempFiles.length) wx.showToast({ title: '部分图片没传上', icon: 'none' })
  },
  onDelPhoto(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i)
    this.setData({ photos: this.data.photos.filter((_, idx) => idx !== i) })
  },
  onPreviewPhoto(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.url || '')
    if (url) wx.previewImage({ current: url, urls: this.data.photos })
  },
  async onSubmit() {
    if (this.data.busy) return
    if (this.data.uploading) {
      wx.showToast({ title: '图片还在上传，稍等一下', icon: 'none' })
      return
    }
    if (!this.data.rating) {
      wx.showToast({ title: '先点星评个分', icon: 'none' })
      return
    }
    tapHaptic()
    this.setData({ busy: true })
    const r = await submitReview(
      this.orderId,
      this.lineId,
      this.data.rating,
      this.data.text.trim(),
      this.data.tags.filter((x) => x.on).map((x) => x.t),
      this.data.anon,
      this.data.photos
    )
    if (this.unloaded) return // 迟到回包：已退页（onUnload 已清 backTimer）——不弹 toast、不 navigateBack
    if (r.ok) {
      // 成功不复位 busy——锁到返回·防延时窗口内二次提交（撞主键回 REVIEWED 的矛盾 toast）；toast 加 mask·定时器存实例待清
      wx.showToast({ title: '感谢你的评价', icon: 'success', mask: true })
      this.backTimer = setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({ busy: false })
    const e = String(r.error || '')
    const msg =
      e === 'REVIEWED'
        ? '这条已经评过了'
        : e === 'NOT_DONE'
          ? '订单完成后才能评价'
          : e === 'IMG_RISKY'
            ? '图片没通过审核，换一张再试'
            : e === 'SEC_CHECK_FAIL'
              ? '图片没检查成功，稍后再试'
              : '提交没成功，稍后再试'
    wx.showToast({ title: msg, icon: 'none' })
  },
})
