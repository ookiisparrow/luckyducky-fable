// 店铺展示名单源（2026-07-25 全量页面体检批）：结算/订单店铺行 + 关于我们/欢迎页店名区。
//
// **为什么单独一个文件、不并进 lib/brand.ts**：品牌字体分层子集（守卫 rw-mp-font-tier-subset-covers）
// 的 tier1「首屏字」＝ tab 页(home/cart/me) 四件套**闭包** ∪ custom-tab-bar ∪ brand-splash ∪ app.ts 闭包。
// brand.ts 被首页链路引用（BRAND_NAME/口号），并进去会把第二行「初学钩织入门」拖进 tier1 闭包——
// 而首页压根不显示店铺全名。拆开后：本文件只被非 tab 页引用，字落 tier2，首屏子集不受影响。
// 品牌核名仍只改 brand.ts 的 BRAND_NAME 一处（守卫 brand-name-single-source 钉死字面量），本文件自动跟随。
import { BRAND_NAME } from './brand'

/** 店名第一行＝品牌核名（决策 R23·2026-06-15）。 */
export const SHOP_NAME_LINE1 = BRAND_NAME
/** 店名第二行（2026-09-03：一行放不下就折到这行）。 */
export const SHOP_NAME_LINE2 = '初学钩织入门'
/** 店铺展示全名（决策 R23·2026-09-03）：核名 + 第二行，中间一个空格。 */
export const SHOP_FULL_NAME = `${BRAND_NAME} ${SHOP_NAME_LINE2}`
