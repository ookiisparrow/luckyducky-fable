// 微信隐私授权闸（R27㉒·旧线 usePrivacyGate 黄金语义原生承接·守卫 rw-mp-privacy-gated）：
// wx.onNeedPrivacyAuthorization 触发 → 打开 privacy-sheet 弹窗 → 用户同意/拒绝回调 resolve 放行/中止本次接口。
// 原生无响应式：可见态经订阅广播（组件 attached 订阅 / detached 退订）。工厂化是为测试各起干净实例；
// 运行时只用单例 privacyGate。
// ⚠️ 运行时行为依赖 mp 后台已登记《小程序用户隐私保护指引》+ 真机验（根因#8 构建过≠真机能用）。
export type PrivacyResolve = (r: { buttonId?: string; event: 'agree' | 'disagree' }) => void

export interface PrivacyGate {
  visible(): boolean
  subscribe(fn: (visible: boolean) => void): () => void
  open(resolve: unknown): void
  agree(buttonId?: string): void
  disagree(): void
  register(w?: { onNeedPrivacyAuthorization?: (cb: (resolve: PrivacyResolve) => void) => void }): void
}

export function createPrivacyGate(): PrivacyGate {
  let pending: PrivacyResolve | null = null
  let shown = false
  const listeners = new Set<(v: boolean) => void>()
  const setShown = (v: boolean) => {
    shown = v
    listeners.forEach((fn) => fn(v))
  }
  return {
    visible: () => shown,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    open(resolve) {
      pending = typeof resolve === 'function' ? (resolve as PrivacyResolve) : null
      setShown(true)
    },
    // 「同意并继续」——须由 open-type=agreePrivacyAuthorization 能力按钮回调触发，buttonId 为该按钮 id
    agree(buttonId = 'privacy-agree-btn') {
      setShown(false)
      if (pending) {
        pending({ buttonId, event: 'agree' })
        pending = null // 只回一次：同意后再拒绝不再回调
      }
    },
    // 「不同意」——中止本次涉隐私接口（不影响无关功能）
    disagree() {
      setShown(false)
      if (pending) {
        pending({ event: 'disagree' })
        pending = null
      }
    },
    // App 启动时注册；wx 缺该 API（基础库过旧/测试环境）安全空转
    register(w = (globalThis as { wx?: Parameters<PrivacyGate['register']>[0] }).wx) {
      if (w && typeof w.onNeedPrivacyAuthorization === 'function') {
        w.onNeedPrivacyAuthorization((resolve) => this.open(resolve))
      }
    },
  }
}

export const privacyGate = createPrivacyGate()
export const registerPrivacyGate = () => privacyGate.register()
