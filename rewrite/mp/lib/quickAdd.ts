// 「+」快速加购决策（M2 批次C·2026-07-08 用户拍板改真加购；2026-07-13 用户拍板：「+」统一＝加入购物车，
// 多规格不再跳详情、默认加首个规格——想换规格走详情页选好再加，购物车只能删行不能改规格）：单规格直加购
// （sku 空·用商品价）；多规格取首个 sku（sku 名 + 首规格价·记一个确定规格与正确价，不留「未选规格」歧义行）；
// raw 缺失/脏形→null（调用方温和反馈，不静默）。首页与购物车推荐位共用本函数——两处「+」必须同语义，
// 否则同商品在两处各成一行（cart 行身份是 id+sku 双键）且价格可能不同。
// 抽纯函数进 lib：分支判定与副作用（cart.add）分离，vitest 钉行为不用桩 wx。
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

export function decideQuickAdd(raw: unknown): QuickAddPayload | null {
  const vm = mapDetail(raw)
  if (!vm) return null
  // 多规格默认加首个规格（有名有价的净化后首行）：记确定规格与该规格价；无规格用商品价、sku 空。
  const first = vm.skus[0]
  const price = first ? first.price : vm.price
  return {
    id: vm.id,
    sku: first ? first.name : '',
    name: vm.name,
    tag: vm.tag,
    price,
    // 划线价是商品级、现价可能取了规格级：划线不高于现价就不透传——否则购物车行会渲染出
    // 「划线 ¥158 < 现价 ¥198」的荒谬组合（cart.wxml wx:if="{{item.was}}" 直渲）。
    was: vm.was !== undefined && vm.was > price ? vm.was : undefined,
    cover: vm.gallery[0] || '',
  }
}
