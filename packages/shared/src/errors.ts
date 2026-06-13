/**
 * 错误码集中收口（根因账本 #3：信任边界靠人记 → 闸 fail-closed，错误码单源）。
 * kit 的闸返回这些码；前端按码提示。B4 起随各函数迁移逐步补全。
 */
export const ERR = {
  NO_OPENID: 'NO_OPENID',
  NO_ID: 'NO_ID',
  NOT_FOUND: 'NOT_FOUND',
  BAD_STATUS: 'BAD_STATUS',
  ADMIN_ONLY: 'ADMIN_ONLY',
} as const

export type ErrorCode = (typeof ERR)[keyof typeof ERR]
