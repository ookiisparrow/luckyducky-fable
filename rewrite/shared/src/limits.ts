/**
 * 交易输入边界（设计约束「不信前端输入」·镜像旧线 limits.ts，parity 焊死）。
 * 单一来源：上架与下单共用，阈值不漂移。
 */
export const MAX_PRICE_YUAN = 100_000
export const MAX_QTY = 999
export const MAX_ORDER_LINES = 100

/** 支付窗口（毫秒）：关单 cron / 惰性关单 / 前端倒计时 三处共用单源。 */
export const PAY_WINDOW_MS = 15 * 60 * 1000

/** 有效价格：有限正数且 ≤ 上限（元）——拦 Number('-5')/Infinity 这类 truthy 非法值。 */
export function isValidPriceYuan(v: unknown): boolean {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE_YUAN
}
