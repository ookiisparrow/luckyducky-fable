import cloud from 'wx-server-sdk'

/**
 * 触发云开发工作流（cloudbase_module 单点收口，根因账本 #12：与微信平台的接缝收到一处，
 * 平台规则变更时改动面最小）。返回工作流 result.data（预付单参数 / 退款结果），
 * 异常或无 data 返回 null（调用方按业务处理）。
 * 消费者：pay（支付流）；adminApi.approveRefund（退款流，B5 迁入）。
 */
export async function callFlow(flowId: string, data: any): Promise<any> {
  const res = await cloud
    .callFunction({ name: 'cloudbase_module', data: { name: flowId, data } })
    .catch(() => null)
  return res && res.result && res.result.data != null ? res.result.data : null
}
