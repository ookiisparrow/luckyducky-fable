/**
 * @luckyducky/shared 入口——种子单一来源（B3 起）、状态/错误码、Fen 金额品牌类型。
 * shared 与 cloud 两包 TS（钱和权限层）；miniapp/admin 页面层维持 JS。
 */
export * from './money'
export * from './order'
export * from './order.spec'
export * from './learning'
export * from './learning.spec'
export * from './cs'
export * from './csAgentDesk'
export * from './scm'
export * from './scm.spec'
export * from './scmBom'
export * from './errors'
export * from './limits'
export * from './seed/products'
export * from './seed/course'
export * from './seed/checkout'

// B0 哨兵：App.vue 仍引用以验证 workspace TS 包被 uni 构建吃下；B3 种子落地后清理。
export const SHARED_PKG_SENTINEL = 'luckyducky-shared-b0'
