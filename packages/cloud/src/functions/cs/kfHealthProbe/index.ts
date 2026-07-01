import { ERR } from '@luckyducky/shared'
import { isServerCall, ok, err, getAccessToken, listKfAccounts, notifyAlert } from '../../../kit'

// 微信客服活体探针（上线后静默故障预警·根因#8「配过一次≠一直通」·调试日志 AA「上线后活体探针缺失」隐患的补法）：
// 定时探「令牌能不能取 + API 能不能真调」——catch 令牌失效(Secret 漂/换) / 可信IP不对(60020) / 权限丢 这类**静默故障**
// （断了只在日志 FORGED/60020、没人盯日志就不知道），经**唯一 botpush 接缝 notifyAlert** 推企微告警到手机（webhook 已配）。
// **服务端专用**（isServerCall·定时触发·带 openid 的客户端调用拒·防刷告警）。
// **诚实边界**：回调验签漂移(FORGED)那类纯自动测不了（需合成一条真顾客消息·做不到）——靠「变更后手动发一条验」+
// 「持续零成功」另兜（见 config手册/调试日志 AA）。本探针兜的是令牌/可信IP/权限这一类（这次逼出 60020/40001 的那类）。
const env = (k: string) => process.env[k] || ''

export const main = async (_event: any) => {
  if (!isServerCall()) return err(ERR.SERVER_ONLY) // 定时/后端专用·带 openid（客户端）拒·防刷告警
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
    await notifyAlert('security', 'kfHealthProbe', 'KF_TOKEN_FAILED', {}) // Secret 失效/gettoken 失败（40001 类）
    return ok({ healthy: false, reason: 'TOKEN_FAILED' })
  }
  const res = await listKfAccounts(token) // 真调读接口——gettoken 抓不到可信IP，须此步探 60020/权限
  if (res && res.errcode) {
    await notifyAlert('security', 'kfHealthProbe', 'KF_API_FAILED', { errcode: res.errcode }) // 60020 可信IP / 权限丢
    return ok({ healthy: false, errcode: res.errcode })
  }
  console.log('[kf-probe] healthy', { accounts: (res && res.account_list && res.account_list.length) || 0 })
  return ok({ healthy: true })
}
