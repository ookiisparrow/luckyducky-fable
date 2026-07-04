import { ERR } from '@ldrw/shared'
import { isServerCall, ok, err, getAccessToken, listKfAccounts, notifyAlert } from '../../kit'

// 微信客服活体探针（黄金 cs-agent §十一·「配过一次≠一直通」）：定时探「令牌能取 + API 能真调」，
// 静默故障（Secret 漂/可信 IP 变/权限丢）推告警。服务端专用；客户端调用拒（防刷告警）。
// gettoken 抓不到可信 IP 问题（60020 真调才报），故必须真调一次读接口。
const env = (k: string) => process.env[k] || ''

export const main = async () => {
  if (!isServerCall()) return err(ERR.SERVER_ONLY)
  const corpid = env('WXKF_CORPID')
  const secret = env('WXKF_SECRET')
  if (!corpid || !secret) {
    await notifyAlert('security', 'kfHealthProbe', 'KF_NOT_CONFIGURED', {})
    return ok({ healthy: false, reason: 'NOT_CONFIGURED' })
  }
  let token: string
  try {
    token = await getAccessToken({ corpid, secret })
  } catch {
    await notifyAlert('security', 'kfHealthProbe', 'KF_TOKEN_FAILED', {})
    return ok({ healthy: false, reason: 'TOKEN_FAILED' })
  }
  const res = await listKfAccounts(token)
  if (res && res.errcode) {
    await notifyAlert('security', 'kfHealthProbe', 'KF_API_FAILED', { errcode: res.errcode })
    return ok({ healthy: false, errcode: res.errcode })
  }
  return ok({ healthy: true })
}
