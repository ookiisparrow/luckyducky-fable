// 编辑资料（M2 批13）：微信头像昵称填写能力（button open-type=chooseAvatar——能力按钮属 button 例外）。
// 头像临时路径先传云存储换 cloud:// 再同步（云端只收 cloud:// 或空·黄金 §九）；上传失败昵称照常同步不带头像字段。
import { login, updateProfile } from '../../api/user'

Page({
  data: {
    nickname: '',
    bio: '',
    phone: '', // 账户联系电话（手动输入·供客服 360 检索·与地址电话独立）
    avatar: '', // cloud:// 或空
    avatarTemp: '', // 本次新选的临时路径（待上传）
    busy: false,
    loaded: false, // 资料是否成功载入（login 成功）·未载入不允许保存（防读故障→空字段→破坏性覆盖清空已存 phone/bio）
  },
  backTimer: null as ReturnType<typeof setTimeout> | null,
  onUnload() {
    if (this.backTimer) clearTimeout(this.backTimer) // 延时返回坞清理（守卫 rw-mp-navback-timer-cleaned）
  },
  async onLoad() {
    const u = await login()
    const user = (u.ok ? u.user : null) as Record<string, any> | null
    if (user) this.setData({ nickname: String(user.nickname || ''), bio: String(user.bio || ''), phone: String(user.phone || ''), avatar: String(user.avatar || ''), loaded: true })
  },
  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    if (this.data.busy) return // 保存在途禁止重选头像：否则 onSave 已捕获的 avatarTemp 与此刻新选的分叉、上传的是旧图（P2·bug sweep R1 #8）
    this.setData({ avatarTemp: e.detail.avatarUrl })
  },
  onNickname(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value })
  },
  onPhone(e: WechatMiniprogram.Input) {
    this.setData({ phone: e.detail.value })
  },
  onBio(e: WechatMiniprogram.Input) {
    this.setData({ bio: e.detail.value })
  },
  async onSave() {
    if (this.data.busy) return
    // fail-closed：资料没载入成功（login 失败→字段空）时禁存——否则空 phone/bio 会把云端已存值静默覆盖清空（读故障不该触发破坏性写）
    if (!this.data.loaded) {
      wx.showToast({ title: '资料没加载好，返回重进一下', icon: 'none' })
      return
    }
    if (!this.data.nickname.trim()) {
      wx.showToast({ title: '起个昵称吧', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    // phone 一并同步（空串=清空·非法号云端白名单会静默剔除·不覆盖旧号）
    const patch: { nickname: string; bio: string; phone: string; avatar?: string } = { nickname: this.data.nickname.trim(), bio: this.data.bio.trim(), phone: this.data.phone.trim() }
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
    if (r.ok && !avatarFailed) {
      // 成功且无需停留：清临时头像（防二次上传孤儿文件）+ 保持 busy 锁定到返回·toast 加 mask 挡点·定时器存实例待清
      this.setData({ avatarTemp: '' })
      wx.showToast({ title: '已保存', icon: 'success', mask: true })
      this.backTimer = setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.setData({ busy: false })
    if (r.ok && avatarFailed) {
      wx.showToast({ title: '资料已存，头像上传没成功', icon: 'none' })
    } else {
      wx.showToast({ title: '保存没成功，稍后再试', icon: 'none' })
    }
  },
})
