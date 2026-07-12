/**
 * 交易输入边界（设计约束「不信前端输入」·镜像旧线 limits.ts，parity 焊死）。
 * 单一来源：上架与下单共用，阈值不漂移。
 */
export const MAX_PRICE_YUAN = 100_000
export const MAX_QTY = 999
export const MAX_ORDER_LINES = 100

/**
 * 同单售后记录扫描上限（钱守恒·根因#7 无界读被服务端默认 100 条静默截断）：applyRefund/overrideRefund/
 * approveRefund 都要读齐同单全部 afterSales 才能算准「已退额度 used」来封顶——裸 .get() 只回 100 条会少算
 * used、令行/单级退款封顶失效（越规重复退）。显式取到此上界；一单理论上限＝MAX_ORDER_LINES 行客户售后 +
 * 若干越规 __ovrN，远低于 1000。命中此上限＝记录数异常，宁 fail-closed 拒退并告警、不敢按截断值算钱。
 */
export const AFTERSALE_SCAN_CAP = 1000

/** 支付窗口（毫秒）：关单 cron / 惰性关单 / 前端倒计时 三处共用单源。 */
export const PAY_WINDOW_MS = 15 * 60 * 1000

/** 有效价格：有限正数且 ≤ 上限（元）——拦 Number('-5')/Infinity 这类 truthy 非法值。 */
export function isValidPriceYuan(v: unknown): boolean {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE_YUAN
}
