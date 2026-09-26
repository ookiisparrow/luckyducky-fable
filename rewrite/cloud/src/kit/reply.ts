import type { ErrCode } from '@ldrw/shared'
/** 统一响应形状（根因#5 单源）：成功 { ok:true, ...data }，失败 { ok:false, error }。 */
// 泛型化：返回类型是 {ok:true} & T 而非 {[x:string]:unknown; ok:true}——索引签名
// 类型赋不进精确契约类型，handler 要标 @ldrw/shared contracts 返回类型必须先有这层推断。
export const ok = <T extends Record<string, unknown>>(data: T = {} as T) => ({ ok: true as const, ...data })
/** extra：失败时仍需带回的上下文（如 CODE_TAKEN 带 courseId）。码只收 ErrCode：新码先去 shared/src/errors.ts 登记，动态码用模板字符串拼已登记的前缀。 */
export const err = <E extends ErrCode, T extends Record<string, unknown> = {}>(error: E, extra: T = {} as T) => ({ ok: false as const, error, ...extra })
