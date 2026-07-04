// 数据共享授权提示态（后台360工作站 B3.3 的 C 端半边·守卫 rw-mp-privacy-gated）：
// 服务端 users.csDataShare 为授权真值（云端 assertDataShareConsent fail-closed 校验）——
// 本地只存「提示」（显示用·非真值），回灌必 sanitize：storage 不可信，只认 boolean，其余回 null=未知。
export const CONSENT_HINT_KEY = 'ld_consent_hint'

export function sanitizeConsentHint(raw: unknown): boolean | null {
  return raw === true || raw === false ? raw : null
}

export function consentLabel(state: boolean | null): string {
  if (state === true) return '当前状态：已同意共享'
  if (state === false) return '当前状态：已撤回授权'
  return '当前状态：尚未选择'
}

export function readConsentHint(): boolean | null {
  try {
    return sanitizeConsentHint(wx.getStorageSync(CONSENT_HINT_KEY))
  } catch {
    return null
  }
}

export function writeConsentHint(v: boolean) {
  try {
    wx.setStorageSync(CONSENT_HINT_KEY, v)
  } catch {
    // 存不上只影响下次进页的显示提示，真值在服务端
  }
}
