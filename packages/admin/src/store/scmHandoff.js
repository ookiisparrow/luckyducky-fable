/**
 * 备货计算器 → 采购管理/外协加工的一次性开单预填中转（进销存车道 D→A/B）。
 * 纯 SPA 内存单例：算完缺口点「去开单」→ 存一份 → 目标页 init 时读一次即清（consume）。
 * 不用 Pinia/持久化——这不是跨页共享的长期状态，只是页面跳转前后的一次性传值，模块单例已够、不用响应式。
 */
let purchase = null
let outwork = null

export function setPurchaseHandoff(payload) {
  purchase = payload
}
export function consumePurchaseHandoff() {
  const p = purchase
  purchase = null
  return p
}
export function setOutworkHandoff(payload) {
  outwork = payload
}
export function consumeOutworkHandoff() {
  const o = outwork
  outwork = null
  return o
}
