// 关于我们（M2 批13·文案 CMS 优先·硬编码降级为默认回退，见 lib/mapPages mapAbout）。品牌名引 lib/brand 单源（病根#5）。
import { BRAND_NAME } from '../../lib/brand'
import { getPageContent } from '../../lib/pageContent'
import { mapAbout } from '../../lib/mapPages'

Page({
  data: {
    brand: BRAND_NAME, // 品牌名恒引 lib/brand 单源（不经 CMS·病根#5）
    lead: mapAbout(null).lead, // 首帧默认（CMS 到达覆盖·不空屏）
    sections: mapAbout(null).sections,
    version: '',
  },
  unloaded: false, // 已退页标记（await 恢复点复核·同 welcome 范式）
  onUnload() {
    this.unloaded = true
  },
  onLoad() {
    // 版本自查（承旧线 bug W 产物：读运行时账号信息而非 manifest）
    try {
      const info = wx.getAccountInfoSync()
      this.setData({ version: info.miniProgram.version || info.miniProgram.envVersion || '' })
    } catch {
      /* 拿不到不显示 */
    }
    void this.loadPageContent()
  },
  // CMS 关于我们文案（fail-soft·拉不到维持默认）：await 恢复点复核 unloaded（守卫纪律）。
  async loadPageContent() {
    const content = await getPageContent('about')
    if (this.unloaded) return
    const vm = mapAbout(content)
    this.setData({ lead: vm.lead, sections: vm.sections })
  },
  onUserAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=user' })
  },
  onPrivacy() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=privacy' })
  },
})
