/** 统一响应形状（根因账本 #5 收口）：成功 { ok:true, ...data }，失败 { ok:false, error }。 */
export const ok = (data: Record<string, unknown> = {}) => ({ ok: true as const, ...data })
// extra：失败时仍需带回的上下文（如 CODE_TAKEN 带 courseId，供 welcome「已被激活」屏按课程取图）。
export const err = (error: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error, ...extra })
