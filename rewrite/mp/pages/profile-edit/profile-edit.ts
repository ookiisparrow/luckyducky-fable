// 编辑资料：微信头像昵称填写能力（button open-type=chooseAvatar——能力按钮属 button 例外）。
// 头像临时路径先传云存储换 cloud:// 再同步（云端只收 cloud:// 或空）；上传失败昵称照常同步不带头像字段。
import { tapHaptic } from '../../lib/haptics'
import { login, updateProfile } from '../../api/user'
import { goBackOrHome } from '../../lib/nav'
import { loginGate } from '../../lib/loginGate'
import { writeStoredCont } from '../../lib/meCont'
import { createHold, type Hold } from '../../lib/hold'
import { keyDown, keyPress, keyUp } from '../../lib/keyFx'
import { fxHint } from '../../lib/pxFx'
import { uploadAvatar, hintProfileFail } from '../../lib/avatar'

// 账户联系电话可入库位数（手落副本·canonical 单源＝云端 actions/user.ts 的 d.length>=7 与 CAPS.phone=11；
// 守卫 rw-mp-list-loadfailed-state 焊死两侧一致）：宽下界容座机/带区号号码，与地址页收货电话同精神。
const PHONE_MIN_DIGITS = 7
const PHONE_MAX_DIGITS = 11

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    dirty: false, // 有没保存的改动（载入后·非保存在途）：<leave-sheet> 据此拦返回键/侧滑先问
    focus: '', // 正在输入的框（nickname/phone）：凹槽亮紫描边
    nickname: '',
    bio: '', // 个性签名：v5 稿不再展示/编辑，原值照载照回传（不把云端已存签名覆盖清空）
    phone: '', // 账户联系电话（手动输入·供客服 360 检索·与地址电话独立）
    avatar: '', // cloud:// 或空
    avatarTemp: '', // 本次新选的临时路径（待上传）
    busy: false,
    loading: true, // login 在途：不画空白可编辑档（根因#14·失败≠空档案）
    loaded: false, // 资料是否成功载入（login 成功）·未载入不允许保存（防读故障→空字段→破坏性覆盖清空已存 phone/bio）
    holdOut: false, // 正在按住「退出登录」（驱动墨色填充）
  },
  backTimer: null as ReturnType<typeof setTimeout> | null,
  orig: { nickname: '', phone: '' }, // 载入时的原值：判断有没有改动（放弃确认）
  unloaded: false, // 保存在途页面已退出标记（同 review.ts 范式）：迟到回包别再对下一页 navigateBack+toast
  // 账号操作（老板 2026-09-30·§39）：退出登录＝按住 0.6s（设计稿 15 题参数）。只退本机登录态，云端资料/课程/进度一概不动，
  // 同一微信再登全部回来。删除个人资料挪到隐私政策正文末尾（pages/agreement）。
  _holdOut: null as Hold | null,
  onUnload() {
    this.unloaded = true
    this._holdOut?.cancel()
    if (this.backTimer) clearTimeout(this.backTimer) // 延时返回坞清理
  },
  async onLoad() {
    this._holdOut = createHold(600, () => this.doLogout(), {
      onQuick: () => fxHint(this, '按住退出登录'),
      onChange: (v) => this.setData({ holdOut: v }),
    })
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
        dirty: false,
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
  /** 改字段/保存在途变了就重算 dirty（口径：资料已载入 && 非保存在途 && 昵称/手机号与原值不同或选了新头像）。 */
  sync(patch: { nickname?: string; phone?: string; avatarTemp?: string; busy?: boolean }) {
    const d = { ...this.data, ...patch }
    const changed = d.nickname !== this.orig.nickname || d.phone !== this.orig.phone || !!d.avatarTemp
    this.setData({ ...patch, dirty: d.loaded && !d.busy && changed })
  },
  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    if (this.data.busy) return // 保存在途禁止重选头像：否则 onSave 已捕获的 avatarTemp 与此刻新选的分叉、上传的是旧图
    this.sync({ avatarTemp: e.detail.avatarUrl })
  },
  onNickname(e: WechatMiniprogram.Input) {
    this.sync({ nickname: e.detail.value })
  },
  onPhone(e: WechatMiniprogram.Input) {
    this.sync({ phone: e.detail.value })
  },
  onFocus(e: WechatMiniprogram.TouchEvent) {
    this.setData({ focus: String(e.currentTarget.dataset.f || '') })
  },
  onBlur(e: WechatMiniprogram.InputBlur) {
    // iOS 从键盘候选栏选「微信昵称」部分版本不触发 input：昵称框失焦时以框内值补同步（值没变不动）
    const v = e && e.detail ? e.detail.value : undefined
    if (e && e.currentTarget.dataset.f === 'nickname' && typeof v === 'string' && v !== this.data.nickname) this.sync({ nickname: v })
    this.setData({ focus: '' })
  },
  onLogoutStart(e: WechatMiniprogram.TouchEvent) {
    keyPress('light') // 按住类键自己 catch 了 touchstart，手感在这里补
    const t = e.touches[0]
    this._holdOut?.start(t?.clientX, t?.clientY)
  },
  onLogoutMove(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0]
    if (t) this._holdOut?.move(t.clientX, t.clientY) // 手指滑开超 10px 作废（顺势滚动不误退）
  },
  onLogoutEnd() {
    this._holdOut?.end()
  },
  onLogoutCancel() {
    this._holdOut?.cancel()
  },
  // 只清本机登录态与「我」页继续学习旧卡；地址簿（只存本机）与授权提示留着——同一微信再登，一切照旧
  doLogout() {
    tapHaptic()
    loginGate.logout()
    writeStoredCont(null)
    wx.showToast({ title: '已退出登录', icon: 'none' }) // 随即退回上一页：原生提示跨页不断
    if (!this.unloaded) this.leaveNow()
  },
  /** 退出后直接走：先撤放弃确认的拦截（有改动也不再问），渲染落地后再返回。 */
  leaveNow() {
    this.setData({ dirty: false }, () => goBackOrHome())
  },
  // 顶栏返回（v5-nav guard）：有改动先弹放弃确认，没改动直接走；侧滑/安卓返回由 <leave-sheet> 自己拦
  onBack() {
    ;(this.selectComponent('#leave') as unknown as { ask(): void }).ask()
  },
  async onSave() {
    if (this.data.busy) return
    // fail-closed：资料没载入成功（login 失败→字段空）时禁存——否则空 phone/bio 会把云端已存值静默覆盖清空（读故障不该触发破坏性写）
    if (!this.data.loaded) {
      fxHint(this, '资料没加载好，返回重进一下')
      return
    }
    // 从没设过昵称（原值空）允许留空：云端空昵称＝不改，照样能只存手机号/头像。
    // 设过再清空才拦——云端不会清掉旧昵称，放过去会「提示已保存、其实没改」（根因#14）。
    if (!this.data.nickname.trim() && this.orig.nickname) {
      fxHint(this, '昵称不能为空')
      return
    }
    // 手机号位数校验（根因#14「写入说假话」）：云端 updateProfile 对 phone 走白名单
    // ——纯数字 7–11 位才入库，否则**剔除不改**（保留旧号）。前端不校验就会出现「填了 6 位 → 弹『已保存』
    // → 其实一个字没存」。空串合法（＝显式清空，云端同样承认）。
    // 数字是手落副本，canonical 单源在 rewrite/cloud/src/functions/app/actions/user.ts（CAPS.phone 与 d.length>=7），
    // 两侧一致由守卫 rw-mp-list-loadfailed-state 焊死（同 lib/checkoutConst.ts 副本范式）。
    const phoneDigits = this.data.phone.trim().replace(/\D/g, '')
    if (this.data.phone.trim() && (phoneDigits.length < PHONE_MIN_DIGITS || phoneDigits.length > PHONE_MAX_DIGITS)) {
      fxHint(this, '手机号填得不对，检查一下')
      return
    }
    tapHaptic()
    this.sync({ busy: true })
    // phone 一并同步（空串=清空·非法号云端白名单会静默剔除·不覆盖旧号）
    const patch: { nickname: string; bio: string; phone: string; avatar?: string } = { nickname: this.data.nickname.trim(), bio: this.data.bio.trim(), phone: this.data.phone.trim() }
    let avatarFailed = false
    if (this.data.avatarTemp) {
      try {
        patch.avatar = await uploadAvatar(this.data.avatarTemp) // 换永久标识再同步
      } catch {
        avatarFailed = true // 上传失败：昵称照常同步·不带头像字段（不清云端旧头像）
      }
    }
    const r = await updateProfile(patch)
    if (this.unloaded) return // 迟到回包：已退页（onUnload 已清 backTimer）——不弹 toast、不 navigateBack
    if (r.ok && !avatarFailed) {
      // 成功且无需停留：清临时头像（防二次上传孤儿文件）+ 保持 busy 锁定到返回·toast 加 mask 挡点·定时器存实例待清
      this.setData({ avatarTemp: '' })
      wx.showToast({ title: '已保存', icon: 'success', mask: true }) // 随后退回上一页：原生提示跨页不断，自绘的会随本页消失
      this.backTimer = setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.sync({ busy: false })
    if (r.ok && avatarFailed) {
      fxHint(this, '资料已存，头像上传没成功')
      return
    }
    // 审核被拒按码说人话（lib/avatar·与「我」页换头像同口径）：本页总送昵称/签名，带了新头像时两样都可能没过
    hintProfileFail(this, r.error, { text: true, avatar: !!patch.avatar })
  },
})
