// 意见反馈：submitFeedback 接 UI（分类/内容/联系方式·云端白名单+限频）。
import { tapHaptic } from '../../lib/haptics'
import { APP_VERSION } from '../../lib/appVersion'
import { submitFeedback } from '../../api/user'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxHint, fxLoaded, fxLoading, fxToast } from '../../lib/pxFx'

const CATS = [
  { key: 'bug', label: '有问题' },
  { key: 'idea', label: '提建议' },
  { key: 'other', label: '其他' },
]

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    cats: CATS,
    cat: 'bug',
    content: '',
    contact: '',
    busy: false,
    ok: false, // 正文去空白后有字：提交键才亮
    dirty: false, // 正文或联系方式去空白后有字（且没在提交）：<leave-sheet> 拦返回先问
    focus: '', // 正在输入的框（content/contact）：凹槽亮紫描边
  },
  backTimer: null as ReturnType<typeof setTimeout> | null,
  // 反馈是非幂等写：超时后原样重交复用同一个键，云端撞键只留一条；改了任何一栏就是新的一次提交，清掉换新键
  idemKey: '',
  unloaded: false, // 提交在途页面已退出标记（同 review.ts 范式）：迟到回包别再对下一页 navigateBack+toast
  onUnload() {
    this.unloaded = true
    if (this.backTimer) clearTimeout(this.backTimer) // 延时返回坞清理·防手动返回后孤儿定时器多弹页
  },
  /** content/contact/busy 变了就重算提交键与「有改动」。 */
  sync(patch: { content?: string; contact?: string; busy?: boolean }) {
    const d = { ...this.data, ...patch }
    const ok = !!d.content.trim()
    this.setData({ ...patch, ok, dirty: !d.busy && (ok || !!d.contact.trim()) })
  },
  onCat(e: WechatMiniprogram.TouchEvent) {
    this.idemKey = ''
    this.setData({ cat: String(e.currentTarget.dataset.key) })
  },
  onContent(e: WechatMiniprogram.TextareaInput) {
    this.idemKey = ''
    this.sync({ content: e.detail.value })
  },
  onContact(e: WechatMiniprogram.Input) {
    this.idemKey = ''
    this.sync({ contact: e.detail.value })
  },
  onFocus(e: WechatMiniprogram.TouchEvent) {
    this.setData({ focus: String(e.currentTarget.dataset.f || '') })
  },
  onBlur() {
    this.setData({ focus: '' })
  },
  // 顶栏返回（v5-nav guard）：有改动先弹放弃确认，没改动直接走（侧滑/安卓返回由 leave-sheet 自己拦）
  onBack() {
    ;(this.selectComponent('#leave') as unknown as { ask(): void }).ask()
  },
  async onSubmit() {
    if (this.data.busy) return
    if (!this.data.content.trim()) {
      fxHint(this, '写点什么吧')
      return
    }
    tapHaptic()
    this.sync({ busy: true })
    fxLoading(this, '提交中') // 设计稿「提交中」加载框（自绘·挡连点）
    if (!this.idemKey) this.idemKey = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)
    const r = await submitFeedback(this.data.content.trim(), this.data.cat, this.data.contact.trim(), this.idemKey, APP_VERSION)
    fxLoaded(this) // 先收加载框再提示
    if (this.unloaded) return // 迟到回包：已退页（onUnload 已清 backTimer）——不弹 toast、不 navigateBack
    if (r.ok) {
      // 成功不复位 busy——锁到返回·防延时窗口内二次提交；toast 加 mask 挡点；定时器存实例待 onUnload 清
      fxToast(this, '已收到，谢谢你', { mask: true }) // 随后退回上一页：上一页接着显示（px-fx 跨页接力）
      this.backTimer = setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.sync({ busy: false })
    const err = String(r.error)
    const tip =
      err === 'RATE_LIMITED' ? '说得有点频繁啦，歇一会' : err === 'SEC_CHECK_FAIL' ? '内容没通过审核，换个说法再试' : '提交没成功，稍后再试'
    fxHint(this, tip)
  },
})
