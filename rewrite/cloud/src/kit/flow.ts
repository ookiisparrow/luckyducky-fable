import cloud from 'wx-server-sdk'
import { alert } from './observe'

/**
 * 触发云开发工作流（设计约束#12 平台接缝单点：与微信支付的收/退款接缝收口一处，
 * 平台规则变更改动面最小）。返回工作流 result.data（预付单参数/退款结果），异常/无 data 返回 null。
 *
 * 失败必留痕（调试案 A·2026-07-04 真单联测逼出）：旧线 `.catch(() => null)` 把平台真实报错吞成
 * 一句 REFUND_TRIGGER_FAIL、排障只能靠猜——两条失败分支（调用异常/有响应无 data）都落
 * [LD_ALERT] 行带 flowId + 报错摘要（截断防日志爆量·不含 openid/凭证），返回语义不变（fail-soft）。
 */
export async function callFlow(flowId: string, data: unknown): Promise<any> {
  const brief = (v: unknown): string => {
    try {
      return String(v instanceof Error ? v.message : JSON.stringify(v)).slice(0, 300)
    } catch {
      return 'UNSERIALIZABLE'
    }
  }
  let res: any
  try {
    res = await cloud.callFunction({ name: 'cloudbase_module', data: { name: flowId, data } })
  } catch (e) {
    alert('money', 'flow', 'FLOW_CALL_FAIL', { flowId, error: brief(e) })
    return null
  }
  if (res && res.result && res.result.data != null) return res.result.data
  alert('money', 'flow', 'FLOW_NO_DATA', { flowId, result: brief(res && res.result) })
  return null
}
