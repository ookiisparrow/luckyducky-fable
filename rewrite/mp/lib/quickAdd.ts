// 首页「+」快速加购决策（M2 批次C·2026-07-08 用户拍板：旧假占位反馈改真加购）：
// 单规格商品直加购物车（不用户择规格是省一步）；多规格商品无处代选，跳详情页选（Rule of Three——
// 不为一个决策分支新建规格弹层组件，详情页早已是规格选择唯一的家）；raw 缺失/脏形→fail（调用方温和反馈，不静默）。
// 抽纯函数进 lib：分支判定与副作用（cart.add/navigateTo）分离，vitest 钉行为不用桩 wx。
import { mapDetail } from './mapDetail'

export interface QuickAddPayload {
  id: string
  sku: string
  name: string
  tag: string
  price: number // 元数字，同 cart.add 入参口径（不混入分——cart.ts 全链走「元」）
  was?: number
  cover: string
}

export type QuickAddDecision = { kind: 'add'; payload: QuickAddPayload } | { kind: 'navigate'; id: string } | { kind: 'fail' }

export function decideQuickAdd(raw: unknown): QuickAddDecision {
  const vm = mapDetail(raw)
  if (!vm) return { kind: 'fail' }
  if (vm.skus.length > 0) return { kind: 'navigate', id: vm.id }
  return {
    kind: 'add',
    payload: { id: vm.id, sku: '', name: vm.name, tag: vm.tag, price: vm.price, was: vm.was, cover: vm.gallery[0] || '' },
  }
}
