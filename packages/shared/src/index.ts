/**
 * @luckyducky/shared 入口。
 *
 * B0 阶段为占位包：唯一职责是验证「miniapp（uni+vite）能直引 workspace TS 包产物」
 * （总计划 B0 判定项③）。B1 起承载状态联合类型 + Fen 金额品牌类型，
 * B3 起承载种子单一来源（catalog/course），届时哨兵常量可删。
 */

// B0 哨兵：App.vue 引用后应原样出现在双端构建产物中（grep 验证）
export const SHARED_PKG_SENTINEL = 'luckyducky-shared-b0'
