// 编辑资料（M2 批13）：微信头像昵称填写能力（button open-type=chooseAvatar——能力按钮属 button 例外）。
// 头像临时路径先传云存储换 cloud:// 再同步（云端只收 cloud:// 或空·黄金 §九）；上传失败昵称照常同步不带头像字段。
import { login, updateProfile } from '../../api/user'

Page({
  data: {
    nickname: '',
    bio: '',
    avatar: '', // cloud:// 或空
    avatarTemp: '', // 本次新选的临时路径（待上传）
    busy: false,
  },
  async onLoad() {
    const u = await login()
    const user = (u.ok ? u.user : null) as Record<string, any> | null
    if (user) this.setData({ nickname: String(user.nickname || ''), bio: String(user.bio || ''), avatar: String(user.avatar || '') })
  },
  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    this.setData({ avatarTemp: e.detail.avatarUrl })
  },
  onNickname(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value })
  },
  onBio(e: WechatMiniprogram.Input) {
    this.setData({ bio: e.detail.value })
  },
  async onSave() {
    if (this.data.busy) return
    if (!this.data.nickname.trim()) {
      wx.showToast({ title: '起个昵称吧', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const patch: { nickname: string; bio: string; avatar?: string } = { nickname: this.data.nickname.trim(), bio: this.data.bio.trim() }
    let avatarFailed = false
    if (this.data.avatarTemp) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`,
          filePath: this.data.avatarTemp,
        })
        patch.avatar = up.fileID // 换永久标识再同步
      } catch {
        avatarFailed = true // 上传失败：昵称照常同步·不带头像字段（不清云端旧头像）
      }
    }
    const r = await updateProfile(patch)
    this.setData({ busy: false })
    if (r.ok && !avatarFailed) {
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } else if (r.ok && avatarFailed) {
      wx.showToast({ title: '资料已存，头像上传没成功', icon: 'none' })
    } else {
      wx.showToast({ title: '保存没成功，稍后再试', icon: 'none' })
    }
  },
})
