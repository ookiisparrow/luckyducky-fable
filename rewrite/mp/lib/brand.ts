// 品牌规范单源（承接旧线 constants/brand.js·R23 定名）：改名/对口径只改这里（病根#5）。
export const BRAND_NAME = 'Lucky Ducky 小棉鸭'
// 店铺全名（结算页/订单详情页店铺行·决策 R23「保留『官方旗舰店』descriptor」）：2026-07-25 全量页面体检
// 补建——此前守卫已点名要求引它、但它根本不存在，两处 wxml 遂各自硬编码 R23 已废弃的开发期占位店名，
// 并借 walk() 不扫 .wxml 的盲区活到生产源（顾客在结算页/订单详情页可见）。改店名只改上一行，本行自动跟随。
export const SHOP_FULL_NAME = `${BRAND_NAME} 官方旗舰店`
// 中文标语口径正册（site/物料以本处为准·site 为独立部署目标其硬编码属已知三源债·见 docs/重构日志.md 2026-07-10 批2 ④）
export const BRAND_SLOGAN_CN = '学习钩织，创造幸运。'
export const BRAND_SLOGAN_EN = 'Get ducky get lucky'
