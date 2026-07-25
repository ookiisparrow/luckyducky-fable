// 店铺展示名单源（2026-07-25 全量页面体检批）：只被结算页/订单详情页的店铺行使用。
//
// **为什么单独一个文件、不并进 lib/brand.ts**：品牌字体分层子集（守卫 rw-mp-font-tier-subset-covers）
// 的 tier1「首屏字」＝ tab 页(home/cart/me) 四件套**闭包** ∪ custom-tab-bar ∪ brand-splash ∪ app.ts 闭包。
// brand.ts 被首页链路引用（BRAND_NAME/口号），并进去会把「旗舰店」三个字一并拖进 tier1 闭包——
// 而 tier1 子集里没有这三个字（首页压根不显示店铺名），真机上该字会静默掉回系统字体。
// 拆开后：本文件只被 order/checkout 引用，字落 tier2（二级页），首屏子集不受影响。
// 改店名仍只改 brand.ts 的 BRAND_NAME 一处，本文件自动跟随。
import { BRAND_NAME } from './brand'

/** 店铺全名（决策 R23「保留『官方旗舰店』descriptor」）：结算页与订单详情页店铺行。 */
export const SHOP_FULL_NAME = `${BRAND_NAME} 官方旗舰店`
