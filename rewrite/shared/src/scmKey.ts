/**
 * SCM 组合键定界符防护（单源·门5 排歧规则·战役3 批D 判例）。
 *
 * 病根：fg 库存/流水键形如 `${productId}__${spec}`（inventory idOf / scmAssembly fg:productId__spec /
 * orders lineIdOf 同构）——若 productId/spec 本身可含 `__` 或以 `_` 结尾，`productId="p_"+spec="q"` 与
 * `productId="p"+spec="_q"` 都拼出同一个 `p___q`，撞键写坏别人的库存文档；productId 含 `__` 也会让
 * 「按首个 __ 反解」的解析（如 scmPlanner.parseFgKey）拆错归属。
 *
 * 排歧规则（唯一定界证明）：拒 productId 含 `__`、拒 productId 以 `_` 结尾（连同既有 spec 含 `__` 拒绝）
 * ⇒ 组合串里的首个 `__` 必然、且只能是拼接分隔符本身——因为 productId 内部不含 `__`、且不以 `_` 收尾
 * （不会与分隔符的首个 `_` 连成新的 `__`），故分隔符前必是 productId 的真实结尾。据此首个 `__` 反解永远
 * 正确、无歧义。
 *
 * 校验落在**出生点**（productId/spec 第一次被写进系统的地方），不落在下游消费点：
 * - scmAssembly.ts runAssembly（组装单据入口）
 * - products.ts saveDraft（cleanProduct 之后——productId=p.id、spec 候选=tag/skus[].name 的宇宙源头）
 * 历史订单/存量库存等下游消费点刻意不校验（fail-closed 会拒发/拒结算既有数据，钱链反噬）——各点位注释
 * 指回本文件说明「校验在出生点·此处历史容忍」。
 */

/** productId 合法性：非空、不含 `__`、不以 `_` 结尾。 */
export function isValidScmProductId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && !id.includes('__') && !id.endsWith('_')
}

/** spec 合法性：不含 `__`（可为空串——无 SKU/无 tag 的成品 spec 合法为空）。 */
export function isValidScmSpec(spec: string): boolean {
  return typeof spec === 'string' && !spec.includes('__')
}
