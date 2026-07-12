// 用户协议 / 隐私政策（M2 批13·批B CMS 优先）：?type=user|privacy 切换。条款正文 CMS 优先、硬编码全文
// 降级为默认回退（见 lib/mapPages mapAgreement）——intro 引言与标题为固定合规文本、不经 CMS 覆盖；CMS
// 仅覆盖更新日期与条款条目，sections 空则回退默认全文（防误清空 2026-06-27 已过审文案·勿随意改动，改动
// 须用户拍板并同步 mp 后台《用户隐私保护指引》）。「管理数据共享授权」入口已接真实 consent 页（同 me.ts）。
import { getPageContent } from '../../lib/pageContent'
import { mapAgreement, type AgreementDocVM } from '../../lib/mapPages'

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
    wx.navigateTo({ url: '/pages/consent/consent' })
  },
})
