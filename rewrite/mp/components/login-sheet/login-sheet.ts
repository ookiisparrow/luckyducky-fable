// 登录授权半屏弹窗（R1·规格§四-1·决策§3）——旧线 components/LoginSheet.vue 原生 mp 移植（重写线补搬）。
// 真·一键登录：勾选同意《用户协议》《隐私政策》→「微信一键登录」用静默 openid 身份直接登录，
// 登录环节不采集头像昵称（守卫 rw-mp-login-no-profile-collect·资料可后续在「编辑资料」页补）。
// 「暂不登录」/点遮罩/✕ 关闭继续逛（软门槛·不强制·合微信运营规范）。各页放一处 <login-sheet/>，
// 经 lib/loginGate 单例共享开关（镜像 privacy-sheet+privacyGate 范式：attached 订阅/detached 退订）。
import { loginGate } from '../../lib/loginGate'
import { login } from '../../api/user'
import { tapHaptic } from '../../lib/haptics'

// 每实例一份退订句柄（页面栈里多页可同时挂本组件，不能共用模块级单变量·同 privacy-sheet）
const unsubs = new WeakMap<object, () => void>()

Component({
  data: { visible: false, agreed: false, submitting: false },
  lifetimes: {
    attached() {
      this.setData({ visible: loginGate.visible() })
      unsubs.set(
        this,
        loginGate.subscribe((v) =>
          // 打开时复位勾选/提交态（同旧线 watch(loginSheetVisible) 复位）；关闭仅收起
          this.setData(v ? { visible: true, agreed: false, submitting: false } : { visible: false })
        )
      )
    },
    detached() {
      unsubs.get(this)?.()
      unsubs.delete(this)
    },
  },
  methods: {
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
        wx.showToast({ title: '请先阅读并勾选同意协议', icon: 'none' })
        return
      }
      tapHaptic() // 禁用/未勾选早退之后、动作提交前（同 lib/haptics 调用纪律）
      this.setData({ submitting: true })
      const res = await login() // 静默 openid 直接登录（零资料采集）+ 服务端记账
      this.setData({ submitting: false })
      if (!res.ok) {
        wx.showToast({ title: '网络不太好，请重试', icon: 'none' })
        return
      }
      loginGate.markAgreed() // 记本地已同意 hint + 关闭
      this.triggerEvent('login')
      wx.showToast({ title: '登录成功', icon: 'none' })
    },
    noop() {},
  },
})
