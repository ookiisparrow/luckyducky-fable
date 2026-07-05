// 备货计算器 → 采购/外协的一次性开单预填中转（旧线 store/scmHandoff.js 移植）。
// 纯 SPA 内存单例：算完缺口点「去开单」→ 存一份 → 目标页 onMounted 读一次即清（consume）。
// 不用 Pinia/持久化——不是跨页长期状态，只是跳转前后一次性传值，模块单例已够。
export interface PurchaseHandoff {
  supplierId: string
  lines: Array<{ materialId: string; qty: number }>
}
export interface OutworkHandoff {
  lines: Array<{ materialId: string; qty: number }>
}

let purchase: PurchaseHandoff | null = null
let outwork: OutworkHandoff | null = null

export function setPurchaseHandoff(payload: PurchaseHandoff): void {
  purchase = payload
}
export function consumePurchaseHandoff(): PurchaseHandoff | null {
  const p = purchase
  purchase = null // 读一次即清·防返回时重复预填
  return p
}
export function setOutworkHandoff(payload: OutworkHandoff): void {
  outwork = payload
}
export function consumeOutworkHandoff(): OutworkHandoff | null {
  const o = outwork
  outwork = null
  return o
}
