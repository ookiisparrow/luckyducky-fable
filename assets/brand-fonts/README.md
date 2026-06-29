# 品牌字体（文源圆体 WenYuan Rounded SC · 子集 WebFont）

这里是**小程序/H5 标题字（`--font-display`）的子集 WebFont 产物**，经 `wx.loadFontFace` 远程加载——
**不进 src、不打进小程序包**（守卫 `font-not-in-package` 机器盯）。

## 文件
- `wenyuan-rounded-medium.woff2` — Medium(500)，~777KB
- `wenyuan-rounded-bold.woff2` — Bold(700)，~792KB
- `LICENSE` — SIL OFL-1.1 全文 + 版权（随字体分发的授权条件③）

子集范围：GB2312 一级常用字（3755 汉字）+ ASCII + 常用中文标点。子集外的字、字体到达前，
自动回退到系统圆体栈（见 `packages/miniapp/src/uni.scss` 的 `$font-display`）。

## 怎么来的 / 怎么重建
源 OTF（84MB·OFL-1.1·不入仓）来自作者发布：https://github.com/takushun-wu/WenYuanFonts

```bash
# 前置：pip install fonttools brotli（提供 pyftsubset）
BRAND_FONT_SRC=/path/to/otf-dir node scripts/build-brand-font.mjs
```
文案出现 GB2312 一级外的字、或要加字重时，改 `scripts/build-brand-font.mjs` 重跑、提交新 woff2、
重新部署到托管。

## 部署（靠人·控制台）
1. 把两个 `.woff2` 传到 CloudBase 静态托管 `/fonts/` 下（URL 单源在 `packages/miniapp/src/constants/brandFont.js`）。
2. 小程序后台「downloadFile 合法域名」加该托管域名——否则 `wx.loadFontFace` 真机静默失败。

## 授权
OFL-1.1。其 **WebFont 特例**：仅为网页端渲染做子集化/格式转换（WOFF/WOFF2）、且不作为可安装桌面字体
提供下载时，可保留保留字名——故子集仍称 WenYuan Rounded SC。详见作者 LICENSE。
