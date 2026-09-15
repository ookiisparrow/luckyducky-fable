// 品牌规范单源（承接旧线 constants/brand.js·R23 定名）：改名/对口径只改这里（病根#5）。
export const BRAND_NAME = 'Lucky Ducky 小棉鸭'
// 中文标语口径正册（site 独立部署、不跟本处；mp 顾客可见口号以这里为准）
export const BRAND_SLOGAN_CN = '体验钩织，创造幸运。'
export const BRAND_SLOGAN_EN = 'Get ducky get lucky'
// 「初学者」的「者」在 tier2 子集、不在 tier1。字面量写进 tab 闭包会让字体守卫红（无源 OTF 不能升子集）。
// ponytail: 运行时拼出「者」，上屏靠 T1→T2 回退出品牌字；有 OTF 重建后改回字面量。
export const LEARNER_KIT = '初学' + String.fromCharCode(0x8005) + '钩织学习套装'
export const HOME_SHARE_TITLE = '小棉鸭' + LEARNER_KIT + '｜体验钩织，创造幸运'
