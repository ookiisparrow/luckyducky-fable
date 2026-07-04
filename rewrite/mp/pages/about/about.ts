// 关于我们（M2 批13·文案承旧线初稿——demo·待用户定稿）。品牌名引 lib/brand 单源（病根#5）。
import { BRAND_NAME, BRAND_SLOGAN_EN } from '../../lib/brand'

const SECTIONS = [
  ['我们是谁', `${BRAND_NAME} 是一家专注钩织的材料包品牌。我们把毛线、配件、工具与配套教学打包成一个个材料包，让没有基础的人也能从第一针开始，亲手钩出属于自己的小鸭与小物。`],
  ['我们做什么', '每一份材料包都配有分步教学视频：扫码开课，跟着视频一针一线，把一团毛线变成可以随身携带的幸运物。从选材到教学，我们只想让「开始」这件事变得足够简单。'],
  ['我们相信', `${BRAND_SLOGAN_EN}。手作的温度来自亲手完成的那一刻——当你为自己或在乎的人钩出一只小鸭，幸运也随之被你亲手创造出来。`],
]

Page({
  data: {
    brand: BRAND_NAME,
    lead: '我们希望每个人都能亲手创造自己的随身幸运物。',
    sections: SECTIONS,
    version: '',
  },
  onLoad() {
    // 版本自查（承旧线 bug W 产物：读运行时账号信息而非 manifest）
    try {
      const info = wx.getAccountInfoSync()
      this.setData({ version: info.miniProgram.version || info.miniProgram.envVersion || '' })
    } catch {
      /* 拿不到不显示 */
    }
  },
  onUserAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=user' })
  },
  onPrivacy() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=privacy' })
  },
})
