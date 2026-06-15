// 店名单一来源（决策 R23 / 占位⑲，2026-06-15 用户定名）。
// 病根#5「样板复制即漂移」：店名曾在 order/checkout/welcome/BrandIntro/GroupPanel/productDetail
// 六处硬编码（order↔checkout 还逐字重复），改名必漏改。收口此处后改名只改这一行；
// 守卫 brand-name-single-source 锁「旧占位绝迹 + 字面量只在本文件」。
export const BRAND_NAME = 'Lucky Ducky 小棉鸭'

// 店铺全称（结算/订单店铺行用）：店名 + 官方旗舰店 descriptor，收口防 checkout/order 两处逐字重复（病根#5·债#30）。
export const SHOP_FULL_NAME = `${BRAND_NAME} 官方旗舰店`
