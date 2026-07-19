/** 统一响应形状（设计约束#5 单源）：成功 { ok:true, ...data }，失败 { ok:false, error }。 */
// 泛型化（批B10 契约批）：返回类型从 {[x:string]:unknown; ok:true} 收窄为 {ok:true} & T——索引签名
// 类型赋不进精确契约类型，handler 要标 @ldrw/shared contracts 返回类型必须先有这层推断。运行时逐字不变。
export const ok = <T extends Record<string, unknown>>(data: T = {} as T) => ({ ok: true as const, ...data })
/** extra：失败时仍需带回的上下文（如 CODE_TAKEN 带 courseId）。动态码（'BAD_STATUS:'+s）允许，生产方应用 rewrite/shared/src/order.ts 的 buildBadStatus() 构造而非手写拼接；字面量码须在 ERR 册内。 */
export const err = (error: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error, ...extra })
