// 编辑资料：微信头像昵称填写能力（button open-type=chooseAvatar——能力按钮属 button 例外）。
// 头像临时路径先传云存储换 cloud:// 再同步（云端只收 cloud:// 或空）；上传失败昵称照常同步不带头像字段。
import { tapHaptic } from '../../lib/haptics'
import { login, updateProfile } from '../../api/user'
import { goBackOrHome } from '../../lib/nav'

// 账户联系电话可入库位数（手落副本·canonical 单源＝云端 actions/user.ts 的 d.length>=7 与 CAPS.phone=11；
// 守卫 rw-mp-list-loadfailed-state 焊死两侧一致）：宽下界容座机/带区号号码，与地址页收货电话同精神。
const PHONE_MIN_DIGITS = 7
const PHONE_MAX_DIGITS = 11

Page({
  data: {
    sb: 20, // 状态栏高（自绘顶栏：返回键要先问「放弃修改？」，v5-nav 的返回拦不住）
    leaveOpen: false, // 「放弃编辑确认」半屏
    nickname: '',
    bio: '', // 个性签名：v5 稿不再展示/编辑，原值照载照回传（不把云端已存签名覆盖清空）
    phone: '', // 账户联系电话（手动输入·供客服 360 检索·与地址电话独立）
    avatar: '', // cloud:// 或空
    avatarTemp: '', // 本次新选的临时路径（待上传）
    busy: false,
    loading: true, // login 在途：不画空白可编辑档（根因#14·失败≠空档案）
    loaded: false, // 资料是否成功载入（login 成功）·未载入不允许保存（防读故障→空字段→破坏性覆盖清空已存 phone/bio）
  },
  backTimer: null as ReturnType<typeof setTimeout> | null,
  orig: { nickname: '', phone: '' }, // 载入时的原值：判断有没有改动（放弃确认）
  unloaded: false, // 保存在途页面已退出标记（同 review.ts 范式）：迟到回包别再对下一页 navigateBack+toast
  onUnload() {
    this.unloaded = true
    if (this.backTimer) clearTimeout(this.backTimer) // 延时返回坞清理
  },
  async onLoad() {
    this.setData({ sb: wx.getWindowInfo().statusBarHeight || 20 })
    let user: Record<string, any> | null = null
    try {
      const u = await login()
      user = (u.ok ? u.user : null) as Record<string, any> | null
    } catch {
      // 抛错与 ok:false 同落失败态：不把空白表单当档案（根因#14）
    }
    if (this.unloaded) return // 资料拉取在途已退页——迟到回包不再 setData
    if (user) {
      this.orig = { nickname: String(user.nickname || ''), phone: String(user.phone || '') }
      this.setData({
        nickname: String(user.nickname || ''),
        bio: String(user.bio || ''),
        phone: String(user.phone || ''),
        avatar: String(user.avatar || ''),
        loaded: true,
        loading: false,
      })
      return
    }
    this.setData({ loading: false, loaded: false })
  },
  onRetryLoad() {
    if (this.data.loading) return
    this.setData({ loading: true })
    return this.onLoad()
  },
  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    if (this.data.busy) return // 保存在途禁止重选头像：否则 onSave 已捕获的 avatarTemp 与此刻新选的分叉、上传的是旧图
    this.setData({ avatarTemp: e.detail.avatarUrl })
  },
  onNickname(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value })
  },
  onPhone(e: WechatMiniprogram.Input) {
    this.setData({ phone: e.detail.value })
  },
  // 返回：资料载入后有改动（昵称/手机号/新选头像）先弹「放弃编辑确认」；保存在途不拦（成功会自己返回）
  // ponytail: 只拦自绘返回键；侧滑/安卓返回键不拦（要拦得挂 page-container，会冻页面级滚动）
  onBack() {
    const d = this.data
    const dirty = d.nickname !== this.orig.nickname || d.phone !== this.orig.phone || !!d.avatarTemp
    if (d.loaded && !d.busy && dirty) {
      this.setData({ leaveOpen: true })
      return
    }
    goBackOrHome()
  },
  onLeaveStay() {
    this.setData({ leaveOpen: false })
  },
  onLeaveGo() {
    this.setData({ leaveOpen: false })
    goBackOrHome()
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
    // 手机号位数校验（根因#14「写入说假话」）：云端 updateProfile 对 phone 走白名单
    // ——纯数字 7–11 位才入库，否则**剔除不改**（保留旧号）。前端不校验就会出现「填了 6 位 → 弹『已保存』
    // → 其实一个字没存」。空串合法（＝显式清空，云端同样承认）。
    // 数字是手落副本，canonical 单源在 rewrite/cloud/src/functions/app/actions/user.ts（CAPS.phone 与 d.length>=7），
    // 两侧一致由守卫 rw-mp-list-loadfailed-state 焊死（同 lib/checkoutConst.ts 副本范式）。
    const phoneDigits = this.data.phone.trim().replace(/\D/g, '')
    if (this.data.phone.trim() && (phoneDigits.length < PHONE_MIN_DIGITS || phoneDigits.length > PHONE_MAX_DIGITS)) {
      wx.showToast({ title: '手机号填得不对，检查一下', icon: 'none' })
      return
    }
    tapHaptic()
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
    if (this.unloaded) return // 迟到回包：已退页（onUnload 已清 backTimer）——不弹 toast、不 navigateBack
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
