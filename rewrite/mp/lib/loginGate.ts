// 登录软门槛（R1·规格§四-1·决策§3）——旧线 packages/miniapp 的 composables/useAuthGate.js +
// components/LoginSheet.vue 原生 mp 移植（重写线漏搬·同播放页预取那类「老线守冻结字节、新线未随迁」）。
// openid 由云开发上下文静默可信（全仓无 wx.login/token）——此处「登录」＝用户显式勾协议同意登录，
// 登录环节不采集头像昵称（真·一键登录·守卫 rw-mp-login-no-profile-collect·资料可后续在「编辑资料」页补）。
// loginGate 单例（镜像 lib/privacyGate 广播范式）：各页 <login-sheet/> 订阅同一开关；
// 已同意真值本地 hint（服务端 users 为准可后续加·镜像 lib/consent「本地 hint·非真值」范式）。
export const LOGIN_HINT_KEY = 'ld_login_hint'

// storage 不可信：只认字面 true 为「已同意登录」，其余（旧脏值/未设/字符串）一律未同意
export function sanitizeLoginHint(raw: unknown): boolean {
  return raw === true
}

export function readLoginHint(): boolean {
  try {
    return sanitizeLoginHint(wx.getStorageSync(LOGIN_HINT_KEY))
  } catch {
    return false
  }
}

export function writeLoginHint(v: boolean): void {
  try {
    wx.setStorageSync(LOGIN_HINT_KEY, v)
  } catch {
    // 存不上只影响下次进页是否再弹提示·不影响 openid 身份（服务端按 openid 记账）
  }
}

type Sub = (visible: boolean) => void

export function createLoginGate() {
  let shown = false
  const subs = new Set<Sub>()
  const emit = () => subs.forEach((f) => f(shown))
  return {
    visible: () => shown,
    subscribe(fn: Sub): () => void {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    open() {
      if (!shown) {
        shown = true
        emit()
      }
    },
    close() {
      if (shown) {
        shown = false
        emit()
      }
    },
    hasAgreed(): boolean {
      return readLoginHint()
    },
    // 软门槛（旧线 ensureLogin 语义）：已同意→放行返回 true；未同意→弹登录半屏并返回 false，调用方据此中止本次动作。
    // 浏览类页面（首页/详情/购物车）不调用——可先逛后登录，不强制前置授权（合微信运营规范）。
    ensureLogin(): boolean {
      if (readLoginHint()) return true
      this.open()
      return false
    },
    // 用户在半屏点「微信一键登录」并成功后：记本地已同意 hint + 关闭弹窗
    markAgreed(): void {
      writeLoginHint(true)
      this.close()
    },
    // 退出登录：清本地已同意 hint（我的页据此显示登出态·默认身份）+ 收起弹窗。
    // 注意 openid 是云开发上下文固定身份（一微信一 openid·mp 无「换账号」）——退出不删服务端 users 资料、
    // 不清 cart/address 本地缓存（同一用户便利态·再登即回·根因#3「换账号泄露」在 mp 不成立）；只重置「显式同意登录」这一态。
    logout(): void {
      writeLoginHint(false)
      this.close()
    },
  }
}

export const loginGate = createLoginGate()
