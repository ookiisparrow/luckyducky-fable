/**
 * 回调工作流「转发节点」代码（正册副本，根因账本 #9）。
 *
 * 微信支付/退款结果先到云开发回调工作流（paynotify / refundnotify），工作流的 script 节点
 * 把通知转发给业务云函数（payCallback / refundCallback）做幂等翻单。**这段代码住在控制台
 * 工作流节点里、不在 git**——本文件是其正册副本，控制台节点变更须先改这里（先 repo 后控制台）。
 *
 * 现网 2026-08-30：只传 name + resource 会炸——工作流 SDK 认 functionName/FunctionName；
 * WeChat v3 常是 camelCase，且 out_trade_no 可能只在 OUTER output。merge+alias 后按 snake_case 转发。
 *
 * 节点环境：云开发工作流 script 节点（Node 运行时，@cloudbase/node-sdk 可用）。
 * 触发器变量名：wepayTrigger。空数据防御=`|| {}`。
 * 回调协议：返回 { errcode: 0 } 告知已收到，否则微信重试推送（幂等由业务云函数保证）。
 * callFunction 失败必须抛出（禁吞）：否则工作流仍 ACK、微信不重试、单子一直 pending。
 */

// ===== paynotify 工作流 script1 节点：转发到 payCallback =====
// 正册那条 paynotify 的 URL 含 2065345255437447170；两条 paynotify 同码双保险（幂等安全）。
const cloudbase = require('@cloudbase/node-sdk')

exports.main = async (event) => {
  // 现网控制台用过 env: 'cloudbase-d4gcssqbv06865479'；SYMBOL_CURRENT_ENV 同样可用。
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const output = (event && event.wepayTrigger && event.wepayTrigger.output) || {}
  const resource = output.resource || {}
  // merge：resource 覆盖同名键，但 out_trade_no / out_refund_no 只在 OUTER 时要保住。
  const data = Object.assign({}, output, resource)
  if (!data.out_trade_no && output.out_trade_no) data.out_trade_no = output.out_trade_no
  if (!data.out_refund_no && output.out_refund_no) data.out_refund_no = output.out_refund_no
  // alias：v3 camelCase → payCallback/refundCallback 认的 snake_case
  if (data.tradeState && !data.trade_state) data.trade_state = data.tradeState
  if (data.transactionId && !data.transaction_id) data.transaction_id = data.transactionId
  if (data.outTradeNo && !data.out_trade_no) data.out_trade_no = data.outTradeNo
  if (data.outRefundNo && !data.out_refund_no) data.out_refund_no = data.outRefundNo
  // FunctionName：工作流 SDK 认 functionName/FunctionName，只写 name 会 FunctionName parameter could not be found
  await app.callFunction({
    name: 'payCallback',
    functionName: 'payCallback',
    FunctionName: 'payCallback',
    data,
  })
  return { errcode: 0, errmsg: 'OK' }
}

// ===== refundnotify 工作流 script 节点：转发到 refundCallback =====
// （同形，仅函数名换 refundCallback；refundnotify 尾号 1863425）
//
// const cloudbase = require('@cloudbase/node-sdk')
// exports.main = async (event) => {
//   // 现网控制台用过 env: 'cloudbase-d4gcssqbv06865479'；SYMBOL_CURRENT_ENV 同样可用。
//   const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
//   const output = (event && event.wepayTrigger && event.wepayTrigger.output) || {}
//   const resource = output.resource || {}
//   const data = Object.assign({}, output, resource)
//   if (!data.out_trade_no && output.out_trade_no) data.out_trade_no = output.out_trade_no
//   if (!data.out_refund_no && output.out_refund_no) data.out_refund_no = output.out_refund_no
//   if (data.tradeState && !data.trade_state) data.trade_state = data.tradeState
//   if (data.transactionId && !data.transaction_id) data.transaction_id = data.transactionId
//   if (data.outTradeNo && !data.out_trade_no) data.out_trade_no = data.outTradeNo
//   if (data.outRefundNo && !data.out_refund_no) data.out_refund_no = data.outRefundNo
//   await app.callFunction({
//     name: 'refundCallback',
//     functionName: 'refundCallback',
//     FunctionName: 'refundCallback',
//     data,
//   })
//   return { errcode: 0, errmsg: 'OK' }
// }
