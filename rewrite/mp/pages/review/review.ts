// 写评价：星级 + 预设标签多选 + 文字 + 晒图 + 匿名开关。闸门全在云端
// （本人已完成订单/商品在单内/一单一行一评——撞主键如实回「已评过」）。
// 有改动（星级/标签/文字/照片任一非空）时 <leave-sheet> 拦返回与侧滑，先问「放弃这条评价？」。
import { tapHaptic } from '../../lib/haptics'
import { submitReview } from '../../api/reviews'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxHint, fxLoaded, fxLoading, fxParty } from '../../lib/pxFx'
import { groundGap } from '../../lib/ground'

const REV_TAGS = ['教程清晰', '很可爱', '适合新手', '包装用心', '物流快', '线材好'] // 预设标签
const REV_LABEL = ['点亮星星打个分', '很差', '较差', '一般', '满意', '超赞'] // 星级文案随 v5 稿 B3（STAR_L）
const SHAKE_MS = 360 // 设计稿 shake 360ms
const MAX_PHOTOS = 3 // 设计稿 canAdd：photos.length < 3
// 封面只认云存储/https 地址（来自 URL 查询串·不可信输入，不给 image 任意 src）
const safeCover = (u: string): string => (/^(cloud|https):\/\//.test(u) ? u : '')
// 云端错误码 → 提示；用 Map 而非对象字面量：'constructor' 这类原型键不会误命中
const REV_ERR = new Map([
  ['REVIEWED', '这条已经评过了'],
  ['NOT_DONE', '订单完成后才能评价'],
  ['IMG_RISKY', '图片没通过审核，换一张再试'],
  // 云端文字违规 / 文字校不了 / 图片校不了都回 SEC_CHECK_FAIL（只有图片违规单独回 IMG_RISKY），分不开，统一说内容
  ['SEC_CHECK_FAIL', '内容没通过审核，改一改再试'],
])
const BACK_AFTER_REVIEWED_MS = 1000 // 已评过：提示后自动返回

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 地面线上方留白（屏高<700 用 56·UI 审查 6 问 2a）
    item: '', // 商品行「名称 · 规格」
    q: '这只小鸭钩得开心吗？', // 问句（有商品名时「{名}钩得开心吗？」）
    cover: '',
    dirty: false, // 有改动→<leave-sheet> 拦返回
    shake: false, // 没打分点发布：星排抖一下
    focus: false, // 文字框聚焦描边（.well-focus）
    rating: 0,
    ratingLabel: REV_LABEL[0],
    tags: REV_TAGS.map((t) => ({ t, on: false })),
    text: '',
    anon: false,
    busy: false,
    starIdx: [1, 2, 3, 4, 5],
    photos: [] as string[], // 已上传云存储 cloud:// fileID（picker 直接以 <image src=cloud://> 显缩略）
    uploading: false,
    maxPhotos: MAX_PHOTOS,
  },
  orderId: '',
  lineId: '',
  backTimer: null as ReturnType<typeof setTimeout> | null,
  unloaded: false, // 提交在途页面已退出标记：提交本身已达服务端，退页后回包只是迟到副作用，不补偿
  onUnload() {
    this.unloaded = true
    if (this.backTimer) clearTimeout(this.backTimer) // 延时返回坞清理
  },
  onLoad(query: Record<string, string | undefined>) {
    const dec = (k: string) => decodeURIComponent(String(query[k] || ''))
    this.orderId = String(query.orderId || '')
    this.lineId = dec('lineId') // 与 mapOrders reviewUrl 的 encodeURIComponent 成对
    const name = dec('name')
    const spec = dec('spec')
    this.setData({
      item: name + (name && spec ? ' · ' + spec : ''),
      q: name ? name + '钩得开心吗？' : '这只小鸭钩得开心吗？',
      cover: safeCover(dec('cover')),
    })
  },
  // 改动表单统一入口：顺手重算 dirty（星级/标签/文字去空格/照片任一非空·设计稿 dirty('review')）
  edit(patch: Record<string, unknown>) {
    const d = { ...this.data, ...patch } as typeof this.data
    const dirty = !!(d.rating || d.tags.some((t) => t.on) || d.text.trim() || d.photos.length)
    this.setData({ ...patch, dirty })
  },
  onBack() {
    ;(this.selectComponent('#leave') as unknown as { ask(): void } | null)?.ask()
  },
  onStar(e: WechatMiniprogram.TouchEvent) {
    const rating = Number(e.currentTarget.dataset.n)
    // 4/5 星撒花：5 星大撒 170 粒、4 星 56 粒，只要换了星级就撒（设计稿 a_star）
    if (rating >= 4 && rating !== this.data.rating) void fxParty(this, '#rv-star-' + rating, rating === 5, rating === 5 ? 170 : 56)
    this.edit({ rating, ratingLabel: REV_LABEL[rating] || REV_LABEL[0] })
  },
  onTag(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i)
    const tags = this.data.tags.map((x, idx) => (idx === i ? { ...x, on: !x.on } : x))
    this.edit({ tags })
  },
  onText(e: WechatMiniprogram.TextareaInput) {
    this.edit({ text: e.detail.value })
  },
  onFocus() {
    this.setData({ focus: true })
  },
  onBlur() {
    this.setData({ focus: false })
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
    if (this.unloaded) return // await 恢复点复核（同 onSubmit 范式）：上传在途已退页——迟到回包不再 setData/toast
    this.edit({ photos: [...this.data.photos, ...ups].slice(0, this.data.maxPhotos), uploading: false })
    if (ups.length < res.tempFiles.length) fxHint(this, '部分图片没传上')
  },
  onDelPhoto(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i)
    this.edit({ photos: this.data.photos.filter((_, idx) => idx !== i) })
  },
  onPreviewPhoto(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.url || '')
    if (url) wx.previewImage({ current: url, urls: this.data.photos })
  },
  async onSubmit() {
    if (this.data.busy) return
    if (this.data.uploading) {
      fxHint(this, '图片还在上传，稍等一下')
      return
    }
    if (!this.data.rating) {
      fxHint(this, '先点亮星星打个分')
      this.setData({ shake: true })
      setTimeout(() => this.setData({ shake: false }), SHAKE_MS)
      return
    }
    tapHaptic()
    this.setData({ busy: true })
    fxLoading(this, '发布中')
    const r = await submitReview(
      this.orderId,
      this.lineId,
      this.data.rating,
      this.data.text.trim(),
      this.data.tags.filter((x) => x.on).map((x) => x.t),
      this.data.anon,
      this.data.photos
    )
    fxLoaded(this)
    if (this.unloaded) return // 迟到回包：已退页（onUnload 已清 backTimer）——不弹 toast、不 navigateBack
    if (r.ok) {
      // 成功不复位 busy——锁到返回·防延时窗口内二次提交（撞主键回 REVIEWED 的矛盾 toast）；toast 加 mask·定时器存实例待清。
      // 成功提示用原生：随后退回上一页，原生提示跨页不断，自绘的会随本页消失。先撤 dirty 让放弃拦截卸下再返回。
      // icon none：带 success 图标时标题最多显示 7 个字，这句会被截。评价要精选后才对外展示，文案照实说。
      fxHint(this, '已提交，精选后展示', { mask: true })
      this.setData({ dirty: false })
      this.backTimer = setTimeout(() => wx.navigateBack(), 800)
      return
    }
    const code = String(r.error || '')
    fxHint(this, REV_ERR.get(code) || '提交没成功，稍后再试')
    if (code === 'REVIEWED') {
      // 已评过：这页没什么可做了——撤 dirty 卸下放弃拦截，busy 保持锁住，1 秒后自动返回
      this.setData({ dirty: false })
      this.backTimer = setTimeout(() => wx.navigateBack(), BACK_AFTER_REVIEWED_MS)
      return
    }
    this.setData({ busy: false })
  },
})
