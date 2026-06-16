/**
 * 错误码集中收口（根因账本 #3：信任边界靠人记 → 闸 fail-closed，错误码单源）。
 * kit 的 `err()` 返回这些码；**前端按精确码分支提示**（order/checkout/aftersales/welcome/review
 * 等多处 === 比对）——故码是契约、不可改名，新增只追加。
 *
 * 本册＝错误码权威登记册（债#29 单源）：守卫 `known-error-codes` 校验全库 `err('字面量')` 的码都在
 * 此册内——打错码即红、新码须先登记。动态码（如 `err('BAD_STATUS:' + status)`）非字面量、不校验。
 * （adminApi 的 HTTP `reply(4xx,{error})` 是另一通道，不在本册范围。）
 */
export const ERR = {
  // 闸 / 身份（kit gate）
  NO_OPENID: 'NO_OPENID',
  ADMIN_ONLY: 'ADMIN_ONLY',
  // 通用参数 / 校验
  NO_ID: 'NO_ID',
  NO_TYPE: 'NO_TYPE',
  BAD_ARGS: 'BAD_ARGS',
  BAD_QTY: 'BAD_QTY',
  BAD_ADDRESS: 'BAD_ADDRESS',
  EMPTY_ITEMS: 'EMPTY_ITEMS',
  EMPTY_PATCH: 'EMPTY_PATCH',
  META_TOO_BIG: 'META_TOO_BIG',
  TOO_MANY_ITEMS: 'TOO_MANY_ITEMS',
  NOT_FOUND: 'NOT_FOUND',
  // 订单 / 支付
  BAD_STATUS: 'BAD_STATUS',
  NO_PRODUCT: 'NO_PRODUCT',
  NO_MAIN_ITEM: 'NO_MAIN_ITEM',
  ORDER_ID_BUSY: 'ORDER_ID_BUSY',
  ORDER_CLOSED: 'ORDER_CLOSED',
  PAY_NOT_ENABLED: 'PAY_NOT_ENABLED',
  PAY_CONFIG_MISSING: 'PAY_CONFIG_MISSING',
  UNIFIED_ORDER_FAIL: 'UNIFIED_ORDER_FAIL',
  // 售后 / 退款
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  NOT_REFUNDABLE: 'NOT_REFUNDABLE',
  NOT_IN_ORDER: 'NOT_IN_ORDER',
  // 激活 / 课程
  INVALID_CODE: 'INVALID_CODE',
  CODE_TAKEN: 'CODE_TAKEN',
  NOTHING_LEFT: 'NOTHING_LEFT',
  NOT_ACTIVATED: 'NOT_ACTIVATED',
  NOT_ENTITLED: 'NOT_ENTITLED',
  NOT_DONE: 'NOT_DONE',
  NO_COURSE: 'NO_COURSE',
  NO_SEGMENT: 'NO_SEGMENT',
  // 评价
  BAD_RATING: 'BAD_RATING',
  REVIEWED: 'REVIEWED',
  // 频控（根因#13）
  RATE_LIMITED: 'RATE_LIMITED',
  // 微信客服身份桥接（kfBind·根因#3 不信前端）
  NO_UNIONID: 'NO_UNIONID',
  KF_NOT_CONFIGURED: 'KF_NOT_CONFIGURED',
  TOKEN_FAILED: 'TOKEN_FAILED',
  NO_EXTERNAL_USERID: 'NO_EXTERNAL_USERID',
} as const

export type ErrorCode = (typeof ERR)[keyof typeof ERR]
