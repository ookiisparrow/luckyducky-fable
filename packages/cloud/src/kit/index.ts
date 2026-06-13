/**
 * cloud-kit 内核入口（根因账本 1/2/3/4/5 的根治载体）。
 * B2 已就位：getDb / ok·err / withOpenId·isServerCall / transition / defineNotifyCallback。
 * B3b：withAdminGate（消费者 seedProducts；seedCourses/initDb/genQrcodes B4 迁入）。
 * B4/B5 随消费者落地：defineHttpApi / callPayFlow / ids / paging / validate
 * （宪章原则 2：抽象须有 ≥2 既有消费者才建，不为虚构未来建）。
 */
export { getDb } from './db'
export { ok, err } from './reply'
export { withOpenId, isServerCall, withAdminGate } from './gate'
export type { OpenIdCtx } from './gate'
export { transition } from './transition'
export type { TransitionResult } from './transition'
export { defineNotifyCallback } from './notify'
export type { NotifyOptions } from './notify'
export { str } from './validate'
export { callFlow } from './flow'
export { pageParams, pageQuery } from './paging'
export type { PageReq, Paged } from './paging'
