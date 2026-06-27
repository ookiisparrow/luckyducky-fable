// 品牌规范单源（决策 R23 / 占位⑲，2026-06-15 定名、2026-06-27 用户补全口径）。改名/对口径只看这里：
//   · 中文名：小棉鸭            · 英文名：Lucky Ducky（带空格）
//   · 中文 slogan：学习钩织，创造幸运。   · 英文 slogan：Get ducky get lucky
//   · 各平台注册名（小程序/服务号/小店/视频号，后台手动设·非代码）：LuckyDucky小棉鸭 初学钩织入门
//     —— 平台名里 LuckyDucky 无空格、且尾带 SEO 关键词「初学钩织入门」（搜一搜命中），与品牌标识两个场景，别混。
//   · 中文名旧变体（曾错掺入的另一种鸭字叫法）已全库绝迹——见守卫绝迹名单（此处不复写该字面量，否则自触守卫）。
// 病根#5「样板复制即漂移」：店名曾在 order/checkout/welcome/BrandIntro/productDetail 等多处硬编码
//（order↔checkout 还逐字重复），改名必漏改。收口此处后改名只改这一行；
// 守卫 brand-name-single-source 锁「旧名变体绝迹名单（定义在守卫内）+ 字面量只在本文件」。
export const BRAND_NAME = 'Lucky Ducky 小棉鸭'

// 店铺全称（结算/订单店铺行用）：店名 + 官方旗舰店 descriptor，收口防 checkout/order 两处逐字重复（病根#5·债#30）。
export const SHOP_FULL_NAME = `${BRAND_NAME} 官方旗舰店`
