/**
 * 数据共享告知同意接口（后台360工作站 B3.3·承面C 车道 C）。
 *
 * setDataShareConsent(agree)：小程序端走云函数 dataConsent（openid 闸 + 频控·云端只写本人 users.csDataShare）；
 *   agree=true 同意 / false 撤回。H5 / App 端无云能力返回 null，由调用方提示「请在微信小程序内操作」。
 * 说明：外包/第三方客服看客户 360 数据前，云端经 kit/csAccess.assertDataShareConsent 校验此态（未同意即拒·
 *   fail-closed）。**服务端为准**；本地仅存一份显示提示（LOCAL_HINT），非授权真值。声明文案见协议/隐私页。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

const LOCAL_HINT = 'ld_data_share_consent' // 仅 UI 显示用的本地提示（服务端为授权真值）

// 读本地显示提示（不代表服务端真值·仅让切换开关有初始态）：true/false/null(未知)
export function readConsentHint() {
  try {
    const v = uni.getStorageSync(LOCAL_HINT)
    return v === '' || v === undefined || v === null ? null : !!v
  } catch {
    return null
  }
}

// 提交同意/撤回：成功返回 true 并同步本地提示；无云/失败返回 false。
export async function setDataShareConsent(agree) {
  try {
    const res = await callCloud('dataConsent', { agree: !!agree })
    if (res?.ok) {
      try {
        uni.setStorageSync(LOCAL_HINT, !!agree)
      } catch {
        /* 存提示失败不影响服务端已生效 */
      }
      return true
    }
    if (res) logger.warn('consent', 'dataConsent 云端拒绝', res)
  } catch (e) {
    logger.warn('consent', 'dataConsent 云端失败', e)
  }
  return false
}
