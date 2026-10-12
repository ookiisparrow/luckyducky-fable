// 登录授权半屏弹窗（R1）。
// 真·一键登录：勾选同意《用户协议》《隐私政策》→「微信一键登录」用静默 openid 身份直接登录，
// 登录环节不采集头像昵称（守卫 rw-mp-login-no-profile-collect·资料可后续在「编辑资料」页补）。
// 「暂不登录」/点遮罩 关闭继续逛（软门槛·不强制·合微信运营规范）。各页放一处 <login-sheet/>，
// 经 lib/loginGate 单例共享开关（镜像 privacy-sheet+privacyGate 范式：attached 订阅/detached 退订）。
// 开关动效走全局 .sh-mask/.sh-panel（开 320ms·关时加 .out 下滑 240ms/遮罩淡出 200ms，等 240ms 再撤节点）。
import { loginGate } from '../../lib/loginGate'
import { login } from '../../api/user'
import { tapHaptic } from '../../lib/haptics'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxHint, fxLoaded, fxLoading, fxToast } from '../../lib/pxFx'

const OUT_MS = 240
const SHAKE_MS = 360 // 设计稿 shake：-6,6,-4,3,0 px

// 每实例一份退订句柄/定时器（页面栈里多页可同时挂本组件，不能共用模块级单变量·同 privacy-sheet）
const unsubs = new WeakMap<object, () => void>()
const timers = new WeakMap<object, ReturnType<typeof setTimeout>>()

/** 提示挂在当前页的 px-fx 上（页面没挂就退回原生提示·lib/pxFx 自带兜底）。 */
const host = () => {
  const pages = getCurrentPages()
  return pages[pages.length - 1] as unknown as Parameters<typeof fxHint>[0]
}

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的全局键帽 .k-*、半屏 .sh-* 与 .v5-scope 色票
  data: { visible: false, out: false, agreed: false, submitting: false, shake: false },
  lifetimes: {
    attached() {
      this.setData({ visible: loginGate.visible() })
      unsubs.set(
        this,
        loginGate.subscribe((v) => {
          clearTimeout(timers.get(this))
          // 打开时复位勾选/提交态；关闭先下滑再撤
          if (v) return this.setData({ visible: true, out: false, agreed: false, submitting: false })
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
    onToggleAgree() {
      this.setData({ agreed: !this.data.agreed })
    },
    onUserAgreement() {
      wx.navigateTo({ url: '/pages/agreement/agreement?type=user' })
    },
    onPrivacy() {
      wx.navigateTo({ url: '/pages/agreement/agreement?type=privacy' })
    },
    onClose() {
      loginGate.close()
    },
    async onLogin() {
      if (this.data.submitting) return
      if (!this.data.agreed) {
        this.setData({ shake: true }) // 协议行抖一下（设计稿 shake）
        setTimeout(() => this.setData({ shake: false }), SHAKE_MS)
        fxHint(host(), '请先勾选同意协议')
        return
      }
      tapHaptic() // 禁用/未勾选早退之后、动作提交前（同 lib/haptics 调用纪律）
      this.setData({ submitting: true })
      // 设计稿「登录中」加载框（自绘·挡连点）挂在发起这页的 px-fx，收也收这页：在途时按返回键关半屏再切 tab，
      // 栈顶已换页，按「此刻栈顶」收会收错页，原页挡板永远留着（#482）
      const h = host()
      fxLoading(h, '登录中')
      const res = await login(true) // 静默 openid 直接登录（零资料采集）+ 服务端记账；true＝刚勾了协议（云端默认开启数据共享·§40）
      fxLoaded(h) // 先收加载框再提示
      this.setData({ submitting: false })
      if (!res.ok) {
        fxHint(host(), '网络不太好，请重试')
        return
      }
      loginGate.markAgreed() // 记本地已同意 hint + 关闭
      this.triggerEvent('login')
      fxToast(host(), '登录成功')
    },
    noop() {},
  },
})
