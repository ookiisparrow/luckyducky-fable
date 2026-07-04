// 意见反馈（M2 批13）：submitFeedback 接 UI（分类/内容/联系方式·云端白名单+限频）。
import { submitFeedback } from '../../api/user'

const CATS = [
  { key: 'bug', label: '有问题' },
  { key: 'idea', label: '提建议' },
  { key: 'other', label: '其他' },
]

Page({
  data: {
    cats: CATS,
    cat: 'bug',
    content: '',
    contact: '',
    busy: false,
  },
  onCat(e: WechatMiniprogram.TouchEvent) {
    this.setData({ cat: String(e.currentTarget.dataset.key) })
  },
  onContent(e: WechatMiniprogram.TextareaInput) {
    this.setData({ content: e.detail.value })
  },
  onContact(e: WechatMiniprogram.Input) {
    this.setData({ contact: e.detail.value })
  },
  async onSubmit() {
    if (this.data.busy) return
    if (!this.data.content.trim()) {
      wx.showToast({ title: '说点什么吧', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const r = await submitFeedback(this.data.content.trim(), this.data.cat, this.data.contact.trim())
    this.setData({ busy: false })
    if (r.ok) {
      wx.showToast({ title: '收到，谢谢你', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } else {
      wx.showToast({ title: String(r.error) === 'RATE_LIMITED' ? '说得有点频繁啦，歇一会' : '提交没成功，稍后再试', icon: 'none' })
    }
  },
})
