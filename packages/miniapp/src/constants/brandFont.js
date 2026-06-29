// 品牌字体（文源圆体 WenYuan Rounded SC）远程加载单源——family + 托管 URL + 字重描述集中一处。
// 子集 WebFont 产物正本在仓根 assets/brand-fonts/（不进包·守卫 font-not-in-package），部署到 CloudBase
// 静态托管 /fonts/ 下；经 App.vue onLaunch 的 uni.loadFontFace(global) 远程加载（mp 走 wx.loadFontFace、
// H5/App 由 uni 注入 @font-face）。标题字 $font-display 首选本字体，到达前/子集外字回退系统圆体（FOUT 可接受）。
// 改托管域名/文件名只改这里。⚠ 托管域名须在小程序后台「downloadFile 合法域名」内，否则真机静默失败。

export const BRAND_FONT_FAMILY = 'WenYuan Rounded SC'

// 托管基址：CloudBase 静态托管·与官网 www 同域（决策§13）。字体放其 /fonts/ 下。
const FONT_HOST = 'https://www.luckyducky.cn'

// 设计 --font-display 实际只用 Medium(500)/Bold(700) 两档（600 回退 700）；加字重在此追加并重跑构建脚本。
// ⚠ 用 woff 不用 woff2：wx.loadFontFace 真机只稳吃 TTF/WOFF，woff2 工具能渲染但真机静默失败（根因#8·2026-06-29 真机逮出）。
export const BRAND_FONT_FACES = [
  { weight: '500', file: 'wenyuan-rounded-medium.woff' },
  { weight: '700', file: 'wenyuan-rounded-bold.woff' },
].map((f) => ({
  family: BRAND_FONT_FAMILY,
  source: `url("${FONT_HOST}/fonts/${f.file}")`,
  desc: { weight: f.weight },
}))
