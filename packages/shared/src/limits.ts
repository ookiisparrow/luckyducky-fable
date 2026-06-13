/**
 * 交易输入边界（外部体检 P1：负数/无穷大/超大输入穿透校验）。
 * 金额单位：元（与现网存储一致；Fen 整数化是后续债，见 money.ts）。
 * 单一来源：上架（adminApi）与下单（createOrder）共用，避免两处阈值漂移。
 */
export const MAX_PRICE_YUAN = 100_000 // 单品 / SKU 价上限（钩织材料包，10 万足够宽）
export const MAX_QTY = 999 // 单条目数量上限
export const MAX_ORDER_LINES = 100 // 一单条目数上限

/**
 * 有效价格：有限正数且 ≤ 上限（元）。
 * `Number('-5')`=-5、`Number('Infinity')`=Infinity 这类「truthy 但非法」的值在此被拦。
 */
export function isValidPriceYuan(v: unknown): boolean {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE_YUAN
}
