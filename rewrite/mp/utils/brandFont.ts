// 品牌字体（文源圆体 WenYuan Rounded SC）远程加载单源——family + 原始 URL 集中一处。改域名/文件名只改这里。
// 真值承接旧线 packages/miniapp/src/constants/brandFont.js + App.vue loadBrandFonts（2026-06-29 真机踩坑定案）。
//
// 加载策略——绕 CORS：
//   mp 渲染层 origin=servicewechat.com，跨域字体须 CDN 发 `Access-Control-Allow-Origin`，而 CloudBase 静态
//   托管 CDN 不发 → loadFontFace(网络URL) 渲染层报 `ERR_CACHE_MISS`（根因#8·2026-06-29 真机逮出·先后排除
//   了格式/证书/调用时机，真凶是 CORS）。故：downloadFile（逻辑层·不受跨域限制·域名在 downloadFile
//   白名单）拉字体 → 读 base64 → loadFontFace(data URI·同源·无 CORS)。rewrite/mp 恒在微信小程序原生环境
//   运行（无 uni-app 多端条件编译），故不需要老线的分端分支。
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

/**
 * 远程加载品牌字体（downloadFile→base64→loadFontFace data URI，绕 CORS）。
 * 失败不阻断启动（策略承老线）；老线各失败分支经 logger.warn 留痕，新线 mp 暂无 logger 基建、
 * 字体降级本身无害（纯视觉回退系统字体，非根因#14「动作类失败」范畴），故刻意不留痕：
 * 任一环节失败都静默退回系统字体，不引 console、不 throw。
 */
export function loadBrandFonts(): void {
  const fs = wx.getFileSystemManager()
  BRAND_FONTS.forEach(({ weight, url }) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200) return // 刻意静默：降级无害不留痕（理由见函数注释）
        fs.readFile({
          filePath: res.tempFilePath,
          encoding: 'base64',
          success: ({ data }) =>
            wx.loadFontFace({
              global: true,
              family: BRAND_FONT_FAMILY,
              source: `url("data:font/woff;charset=utf-8;base64,${data}")`,
              desc: { weight },
              fail: () => {}, // 刻意静默：降级无害不留痕（理由见函数注释）
            }),
          fail: () => {}, // 刻意静默：降级无害不留痕（理由见函数注释）
        })
      },
      fail: () => {}, // 刻意静默：降级无害不留痕（理由见函数注释）
    })
  })
}
