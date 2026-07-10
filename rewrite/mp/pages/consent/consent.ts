// 数据共享授权页（后台360工作站 B3.3·承旧线 pkg-extra/consent 语义）：对「外包/第三方客服在服务
// 所必需范围内查看订单/物流/学习/咨询记录」作同意/撤回。写云 dataConsent（openid 闸·服务端为真值·
// 外包坐席看 360 前云端 fail-closed 校验此态）；本地只存提示，进页显示用。完整声明文案在协议/隐私页。
import { setDataShareConsent } from '../../api/user'
import { readConsentHint, writeConsentHint, consentLabel } from '../../lib/consent'

Page({
  data: {
    state: null as boolean | null,
    stateLabel: consentLabel(null),
    busy: false,
  },
  unloaded: false, // 页面已退出标记（H3·守卫 rw-mp-await-side-effect-unloaded-recheck 点名·同 checkout/order-list 范式）
  onLoad() {
    const s = readConsentHint()
    this.setData({ state: s, stateLabel: consentLabel(s) })
  },
  onUnload() {
    this.unloaded = true
  },
  async submit(agree: boolean) {
    if (this.data.busy) return
    this.setData({ busy: true })
    const r = await setDataShareConsent(agree)
    if (this.unloaded) return // 页面已退出：不再对已退页 setData/toast（静默，无钱副作用，本页无需像 checkout 那样补提示）
    this.setData({ busy: false })
    if (r.ok) {
      writeConsentHint(agree)
      this.setData({ state: agree, stateLabel: consentLabel(agree) })
      wx.showToast({ title: agree ? '已同意数据共享' : '已撤回授权', icon: 'none' })
    } else {
      wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' })
    }
  },
  onAgree() {
    this.submit(true)
  },
  onRevoke() {
    this.submit(false)
  },
  onPolicy() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=privacy' })
  },
})
