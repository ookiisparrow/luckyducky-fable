/** 统一响应形状（设计约束#5 单源）：成功 { ok:true, ...data }，失败 { ok:false, error }。 */
export const ok = (data: Record<string, unknown> = {}) => ({ ok: true as const, ...data })
/** extra：失败时仍需带回的上下文（如 CODE_TAKEN 带 courseId）。动态码（'BAD_STATUS:'+s）允许，字面量码须在 ERR 册内。 */
export const err = (error: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error, ...extra })
