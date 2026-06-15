/**
 * 微信隐私授权闸（R27㉒，配套 components/PrivacySheet.vue）。
 * 微信小程序在调用涉隐私接口前会触发 wx.onNeedPrivacyAuthorization；本闸把该回调接成一个
 * 半屏弹窗（privacySheetVisible 模块级单例，仿 composables/useAuthGate.js 的 loginSheetVisible）：
 *   - registerPrivacyGate()：App.vue onLaunch 调一次，挂上 onNeedPrivacyAuthorization。
 *   - agreePrivacy() / disagreePrivacy()：弹窗里用户点同意/拒绝后回调 resolve，放行/中止本次接口。
 *
 * ⚠️ 运行时行为依赖 mp 后台已登记《小程序用户隐私保护指引》+ 真机验（根因#8 构建过≠真机能用）；
 *    纯状态逻辑（开关切换 / resolve 落地 / 只回调一次）由 tests/privacyGate.test.js 兜底。
 * 其它端（H5 / App / Node 测试）无 wx，registerPrivacyGate 安全空转。
 */
import { ref } from 'vue'

// 各页 <PrivacySheet/> 与本闸共享同一开关（模块级单例）
export const privacySheetVisible = ref(false)
let pendingResolve = null

// 微信需要隐私授权时打开弹窗，记住本次 resolve（同意/拒绝时回调它放行/中止）
export function openPrivacyGate(resolve) {
  pendingResolve = typeof resolve === 'function' ? resolve : null
  privacySheetVisible.value = true
}

// 用户点「同意并继续」（agreePrivacyAuthorization 按钮回调后调用；buttonId 须为该按钮的 id）
export function agreePrivacy(buttonId = 'privacy-agree-btn') {
  privacySheetVisible.value = false
  if (pendingResolve) {
    pendingResolve({ buttonId, event: 'agree' })
    pendingResolve = null
  }
}

// 用户点「不同意」——中止本次涉隐私接口（不影响无关功能）
export function disagreePrivacy() {
  privacySheetVisible.value = false
  if (pendingResolve) {
    pendingResolve({ event: 'disagree' })
    pendingResolve = null
  }
}

// App 启动时注册（仅微信小程序端；H5 / App / Node 无 wx 时空转）
export function registerPrivacyGate() {
  // #ifdef MP-WEIXIN
  const w = globalThis.wx
  if (w && typeof w.onNeedPrivacyAuthorization === 'function') {
    w.onNeedPrivacyAuthorization((resolve) => openPrivacyGate(resolve))
  }
  // #endif
}
