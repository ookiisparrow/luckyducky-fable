/**
 * 回调工作流「转发节点」代码（正册副本，根因账本 #9）。
 *
 * 微信支付/退款结果先到云开发回调工作流（paynotify / refundnotify），工作流的 script 节点
 * 把通知转发给业务云函数（payCallback / refundCallback）做幂等翻单。**这段代码住在控制台
 * 工作流节点里、不在 git**——本文件是其正册副本，控制台节点变更须先改这里（先 repo 后控制台）。
 *
 * ⚠️ 这是据 docs/工作日志（2026-06-12）+ 记忆重建的副本，非从控制台导出的逐字原文；
 *    首次以本仓为权威前，须按 README 的 drift-checklist 对照线上节点核一遍并校正本文件。
 *
 * 节点环境：云开发工作流 script 节点（Node 运行时，@cloudbase/node-sdk 可用）。
 * 触发器变量名：wepayTrigger（支付/退款通知挂在其 output.resource）。空数据防御=`|| {}`。
 * 回调协议：返回 { errcode: 0 } 告知已收到，否则微信重试推送（幂等由业务云函数保证）。
 */

// ===== paynotify 工作流 script1 节点：转发到 payCallback =====
// 正册那条 paynotify 的 URL 含 2065345255437447170；两条 paynotify 同码双保险（幂等安全）。
const cloudbase = require('@cloudbase/node-sdk')

exports.main = async (event) => {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const resource = (event && event.wepayTrigger && event.wepayTrigger.output && event.wepayTrigger.output.resource) || {}
  await app.callFunction({ name: 'payCallback', data: resource })
  return { errcode: 0, errmsg: 'OK' }
}

// ===== refundnotify 工作流 script 节点：转发到 refundCallback =====
// （同形，仅函数名换 refundCallback；refundnotify 尾号 1863425）
//
// const cloudbase = require('@cloudbase/node-sdk')
// exports.main = async (event) => {
//   const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
//   const resource = (event && event.wepayTrigger && event.wepayTrigger.output && event.wepayTrigger.output.resource) || {}
//   await app.callFunction({ name: 'refundCallback', data: resource })
//   return { errcode: 0, errmsg: 'OK' }
// }
