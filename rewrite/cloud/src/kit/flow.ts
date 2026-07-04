import cloud from 'wx-server-sdk'

/**
 * 触发云开发工作流（设计约束#12 平台接缝单点：与微信支付的收/退款接缝收口一处，
 * 平台规则变更改动面最小）。返回工作流 result.data（预付单参数/退款结果），异常/无 data 返回 null。
 */
export async function callFlow(flowId: string, data: unknown): Promise<any> {
  const res = await cloud.callFunction({ name: 'cloudbase_module', data: { name: flowId, data } }).catch(() => null)
  return res && res.result && res.result.data != null ? res.result.data : null
}
