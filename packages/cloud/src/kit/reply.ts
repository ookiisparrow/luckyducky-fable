/** 统一响应形状（根因账本 #5 收口）：成功 { ok:true, ...data }，失败 { ok:false, error }。 */
export const ok = (data: Record<string, unknown> = {}) => ({ ok: true as const, ...data })
export const err = (error: string) => ({ ok: false as const, error })
