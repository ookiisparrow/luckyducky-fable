// 品牌字体（文源圆体 WenYuan Rounded SC）远程加载单源——family + 原始 URL 集中一处。改域名/文件名只改这里。
//
// 加载策略（实现见 App.vue loadBrandFonts）——绕 CORS：
//   mp 渲染层 origin=servicewechat.com，跨域字体须 CDN 发 `Access-Control-Allow-Origin`，而 CloudBase 静态
//   托管 CDN 不发 → loadFontFace(网络URL) 渲染层报 `ERR_CACHE_MISS`（根因#8·2026-06-29 真机逮出·先后排除
//   了格式/证书/调用时机，真凶是 CORS）。故 mp 端改：downloadFile（逻辑层·不受跨域限制·域名在 downloadFile
//   白名单）拉字体 → 读 base64 → loadFontFace(data URI·同源·无 CORS)。H5/App 端退回直接 loadFontFace(网络URL)。
//
// ⚠ 子集产物正本在仓根 assets/brand-fonts/（不进包·守卫 font-not-in-package），部署到静态托管 /fonts/ 下。
// ⚠ 用 woff 不用 woff2（wx.loadFontFace 只稳吃 TTF/WOFF）。
// ⚠ 用默认域名 cloudbase-….tcloudbaseapp.com（DigiCert·同视频域名 CA）不用自有 www.luckyducky.cn（TrustAsia·手机微信对 CA 挑剔）。
// ⚠ FONT_HOST 域名须在小程序后台「downloadFile 合法域名」内。

export const BRAND_FONT_FAMILY = 'WenYuan Rounded SC'

const FONT_HOST = 'https://cloudbase-d4gcssqbv06865479-1440904924.tcloudbaseapp.com'

// 设计 --font-display 实际只用 Medium(500)/Bold(700) 两档（600 回退 700）；加字重在此追加并重跑构建脚本。
export const BRAND_FONTS = [
  { weight: '500', url: `${FONT_HOST}/fonts/wenyuan-rounded-medium.woff` },
  { weight: '700', url: `${FONT_HOST}/fonts/wenyuan-rounded-bold.woff` },
]
