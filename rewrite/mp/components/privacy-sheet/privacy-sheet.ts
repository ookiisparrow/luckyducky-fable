// 微信隐私授权半屏弹窗（R27㉒·配套 lib/privacyGate）。涉隐私接口页挂本组件（守卫 rw-mp-privacy-gated 扫描制）；
// 「同意并继续」须原生 button open-type=agreePrivacyAuthorization（能力按钮）。attached 订阅/detached 退订。
import { privacyGate } from '../../lib/privacyGate'

// 每实例一份退订句柄（页面栈里多页可同时挂本组件，不能共用模块级单变量）
const unsubs = new WeakMap<object, () => void>()

Component({
  data: { visible: false },
  lifetimes: {
    attached() {
      this.setData({ visible: privacyGate.visible() })
      unsubs.set(
        this,
        privacyGate.subscribe((v) => this.setData({ visible: v }))
      )
    },
    detached() {
      unsubs.get(this)?.()
      unsubs.delete(this)
    },
  },
  methods: {
    onAgree() {
      privacyGate.agree('privacy-agree-btn')
    },
    onDisagree() {
      privacyGate.disagree()
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
