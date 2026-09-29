// 用户协议 / 隐私政策（CMS 优先）：?type=user|privacy 切换。条款正文 CMS 优先、硬编码全文
// 降级为默认回退（见 lib/mapPages mapAgreement）——intro 引言与标题为固定合规文本、不经 CMS 覆盖；CMS
// 仅覆盖更新日期与条款条目，sections 空则回退默认全文（防误清空已过审文案·勿随意改动，改动
// 须用户拍板并同步 mp 后台《用户隐私保护指引》）。「管理数据共享授权」入口已接真实 consent 页（同 me.ts）。
import { getPageContent } from '../../lib/pageContent'
import { mapAgreement, type AgreementDocVM } from '../../lib/mapPages'
import { navigateOrRedirect } from '../../lib/nav'
import { openCustomerService } from '../../utils/customerService'
import { deleteAccount } from '../../api/user'
import { clearAll as clearAddresses } from '../../lib/address'
import { loginGate } from '../../lib/loginGate'
import { writeStoredCont } from '../../lib/meCont'
import { clearConsentHint } from '../../lib/consent'
import { tapHaptic } from '../../lib/haptics'

Page({
  data: {
    doc: mapAgreement(null).user as AgreementDocVM, // 首帧默认（onLoad 按 type 切·CMS 到达再覆盖·不空屏）
    isPrivacy: false,
  },
  unloaded: false, // 已退页标记（await 恢复点复核·同 welcome 范式）
  onUnload() {
    this.unloaded = true
  },
  onLoad(query: Record<string, string | undefined>) {
    const isPrivacy = query.type === 'privacy'
    const vm = mapAgreement(null)
    const doc = isPrivacy ? vm.privacy : vm.user
    this.setData({ doc, isPrivacy })
    wx.setNavigationBarTitle({ title: doc.title })
    void this.loadPageContent(isPrivacy)
  },
  // CMS 协议正文（fail-soft·拉不到维持默认全文）：await 恢复点复核 unloaded（守卫纪律）。
  async loadPageContent(isPrivacy: boolean) {
    const content = await getPageContent('agreement')
    if (this.unloaded) return
    const vm = mapAgreement(content)
    this.setData({ doc: isPrivacy ? vm.privacy : vm.user })
  },
  onConsent() {
    navigateOrRedirect('/pages/consent/consent') // 协议↔授权可反复互跳：栈满改替换，不无响应
  },
  onKefu() {
    openCustomerService()
  },
  // 删除个人资料（隐私政策第六条·老板 2026-09-30 从编辑资料页挪到这里·§39）：确认框讲清删什么、课程与进度保留。
  _deleting: false,
  onDeleteData() {
    tapHaptic()
    wx.showModal({
      title: '删除个人资料',
      content: '将删除你的昵称、头像、签名、手机号和本机地址簿，评价改为匿名。已解锁的课程和学习进度会保留，订单依法留存。删除后不能恢复。',
      confirmText: '删除',
      confirmColor: '#D9483B', // 不可恢复操作：确认键警示红（= tokens --v5-err·原生弹窗只收 hex）
      success: (r) => {
        if (r.confirm) void this.runDeleteData()
      },
    })
  },
  async runDeleteData() {
    if (this._deleting) return
    this._deleting = true
    wx.showLoading({ title: '删除中', mask: true }) // 遮罩挡住在途连点/返回（服务端要跑好几步批删）
    let r: { ok: boolean }
    try {
      r = await deleteAccount()
    } finally {
      wx.hideLoading()
      this._deleting = false
    }
    if (!r.ok) {
      wx.showToast({ title: '没删成，请稍后再试', icon: 'none' })
      return
    }
    clearAddresses() // 地址簿只存本机
    clearConsentHint() // 服务端已把数据共享授权重置；本机旧提示别再显示「已同意」
    loginGate.logout()
    writeStoredCont(null)
    wx.showToast({ title: '已删除', icon: 'none' })
  },
})
