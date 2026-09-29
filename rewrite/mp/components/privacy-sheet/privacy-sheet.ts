// 微信隐私授权半屏弹窗（R27·配套 lib/privacyGate）。涉隐私接口页挂本组件（守卫 rw-mp-privacy-gated 扫描制）；
// 「同意并继续」须原生 button open-type=agreePrivacyAuthorization（能力按钮）。attached 订阅/detached 退订。
// 开关动效走全局 .sh-mask/.sh-panel（同 login-sheet：关时加 .out，等 240ms 再撤节点）。
import { privacyGate } from '../../lib/privacyGate'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxHint } from '../../lib/pxFx'

const OUT_MS = 240

// 每实例一份退订句柄/定时器（页面栈里多页可同时挂本组件，不能共用模块级单变量）
const unsubs = new WeakMap<object, () => void>()
const timers = new WeakMap<object, ReturnType<typeof setTimeout>>()

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的全局键帽 .k-*、半屏 .sh-* 与 .v5-scope 色票
  data: { visible: false, out: false },
  lifetimes: {
    attached() {
      this.setData({ visible: privacyGate.visible() })
      unsubs.set(
        this,
        privacyGate.subscribe((v) => {
          clearTimeout(timers.get(this))
          if (v) return this.setData({ visible: true, out: false })
          if (!this.data.visible) return
          this.setData({ out: true })
          timers.set(
            this,
            setTimeout(() => this.setData({ visible: false, out: false }), OUT_MS)
          )
        })
      )
    },
    detached() {
      unsubs.get(this)?.()
      unsubs.delete(this)
      clearTimeout(timers.get(this))
    },
  },
  methods: {
    onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
    onKeyUp: keyUp,
    onAgree() {
      privacyGate.agree('privacy-agree-btn')
    },
    onDisagree() {
      privacyGate.disagree()
      const pages = getCurrentPages()
      fxHint(pages[pages.length - 1] as unknown as Parameters<typeof fxHint>[0], '未同意，暂时用不了这个功能') // 页面没挂 px-fx 退回原生提示
    },
    onContract() {
      if (typeof wx.openPrivacyContract === 'function') wx.openPrivacyContract({})
    },
    onPolicy() {
      wx.navigateTo({ url: '/pages/agreement/agreement?type=privacy' })
    },
    noop() {},
  },
})
