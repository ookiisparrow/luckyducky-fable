// 数据共享授权页：对「外包/第三方客服在服务
// 所必需范围内查看订单/物流/学习/咨询记录」作同意/撤回。写云 dataConsent（openid 闸·服务端为真值·
// 外包坐席看 360 前云端 fail-closed 校验此态）；本地只存提示，进页显示用。完整声明文案在协议/隐私页。
import { tapHaptic } from '../../lib/haptics'
import { login, setDataShareConsent } from '../../api/user'
import { readConsentHint, writeConsentHint, clearConsentHint, consentLabel } from '../../lib/consent'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxHint, fxToast } from '../../lib/pxFx'
import { navigateOrRedirect } from '../../lib/nav'
import { openCustomerService } from '../../utils/customerService'

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    state: null as boolean | null,
    stateLabel: consentLabel(null),
    busy: false,
  },
  unloaded: false, // 页面已退出标记（同 checkout/order-list 范式）
  submitted: false, // 本页点过同意/撤回：进页的服务端读回包晚到时不再覆盖
  onLoad() {
    const s = readConsentHint()
    this.setData({ state: s, stateLabel: consentLabel(s) })
    void this.syncFromServer()
  },
  /** 以服务端为准（跨设备改过/删过资料时本机提示会旧）：login 回包带本人 users 档，csDataShare.agreed 即真值；
   *  档里没有＝从没选过。拉不到就留本机提示，不把失败当「尚未选择」。 */
  async syncFromServer() {
    const u = await login().catch(() => null)
    const user = u && u.ok ? (u.user as { csDataShare?: { agreed?: unknown } } | undefined) : undefined
    if (!user || typeof user !== 'object' || this.unloaded || this.submitted) return // 没拿到本人档＝不算服务端答复
    const cs = user.csDataShare
    const s = cs && typeof cs.agreed === 'boolean' ? cs.agreed : null
    if (s === null) clearConsentHint()
    else writeConsentHint(s)
    this.setData({ state: s, stateLabel: consentLabel(s) })
  },
  onUnload() {
    this.unloaded = true
  },
  async submit(agree: boolean) {
    if (this.data.busy) return
    this.submitted = true
    this.setData({ busy: true })
    const r = await setDataShareConsent(agree)
    // 提示先于退页复核落盘：服务端已生效而本机不记，下次进页会显示改之前的状态（本页是唯一写入点）
    if (r.ok) writeConsentHint(agree)
    if (this.unloaded) return // 页面已退出：不再对已退页 setData/toast（静默，无钱副作用，本页无需像 checkout 那样补提示）
    this.setData({ busy: false })
    if (r.ok) {
      this.setData({ state: agree, stateLabel: consentLabel(agree) })
      fxToast(this, agree ? '已同意数据共享' : '已撤回授权')
    } else {
      fxHint(this, '操作失败，请稍后重试')
    }
  },
  onAgree() {
    if (this.data.busy) return // 提交在途（按钮态）：不重复触发、不震
    tapHaptic()
    this.submit(true)
  },
  onRevoke() {
    this.submit(false)
  },
  onPolicy() {
    navigateOrRedirect('/pages/agreement/agreement?type=privacy') // 协议↔授权可反复互跳：栈满改替换，不无响应
  },
  onKefu() {
    openCustomerService()
  },
})
