# 品牌字体（文源圆体 WenYuan Rounded SC · 分层子集 WebFont）

这里是**小程序标题/正文字（`--ld-font-brand`）的分层子集 WebFont 产物**，经 `wx.loadFontFace` 远程
分层加载（`rewrite/mp/utils/brandFont.ts`）——**不进 src、不打进小程序包**（守卫 `font-not-in-package`）。

## 文件（2026-07-16 字体分层批·v2）

| 层 | 覆盖 | CJK | 文件（Medium 500 / Bold 700） | 体积 |
|---|---|---|---|---|
| tier1 | tab 首屏（home/cart/me 闭包+tabBar+splash+seed 商品/课程标题）+ASCII+标点 | 428 | `wenyuan-tier1-{medium,bold}.v2.woff` | ~110KB ×2 |
| tier2 | 其余 20 个二级页闭包 + 云端可上屏文案 + 高频补字（圳） | 458 | `wenyuan-tier2-{medium,bold}.v2.woff` | ~111KB ×2 |
| tier3 | GB2312 一级剩余（UGC 昵称/评价/地址兜底） | 2878 | `wenyuan-tier3-{medium,bold}.v2.woff` | ~765KB ×2 |

- `tier{1,2,3}.txt` — 各层字符集正本（构建产物·与 woff 同批出·**勿手改**——守卫
  `rw-mp-font-tier-subset-covers` 只读 txt，txt 新 woff 旧＝守卫绿但真机缺字）。
- `LICENSE` — SIL OFL-1.1 全文 + 版权（随字体分发的授权条件③）。

> ⚠ 用 **woff** 不用 woff2：`wx.loadFontFace` 官方建议格式仅 TTF/WOFF，woff2 开发者工具能渲染（假绿）
> 真机静默失败（根因#8·2026-06-29 真机逮出）。
> ⚠ 文件名带版本号（`.v2`）：字符集/分层变更＝版本 +1＝新文件名＝CDN 与本地缓存天然失效。
> 版本常量在 `scripts/build-brand-font.mjs`（`V`），须与 `rewrite/mp/utils/brandFont.ts` 文件名同步改。

子集外的字、字体到达前，自动回退：tier1 缺的字 → tier2 → tier3 → 系统圆体栈（CSS 逐字回退·
`rewrite/mp/styles/tokens.wxss` 的 `--ld-font-brand`）。

## 怎么来的 / 怎么重建

源 OTF（84MB·OFL-1.1·不入仓）来自作者发布：https://github.com/takushun-wu/WenYuanFonts

```bash
# 前置：pip install fonttools brotli（提供 pyftsubset）
BRAND_FONT_SRC=/path/to/otf-dir node scripts/build-brand-font.mjs
```

分层字符集**从仓内代码推导**（单源 `scripts/lib/brand-font-charset.mjs`·tab 闭包/二级页闭包/GB 兜底）。
新增文案带来子集外新字时守卫 `rw-mp-font-tier-subset-covers` 会红并点名——重跑构建、提交新产物
（txt+woff 全套）、按下节重新部署。

## 部署（靠人·控制台）

1. 6 个 `.woff` 传到 CloudBase 静态托管 `/fonts/` 下（URL 单源 `rewrite/mp/utils/brandFont.ts`）。
   旧 `wenyuan-rounded-{medium,bold}.woff` 可暂留托管作回滚（真机验过分层后再删）。
2. 小程序后台「downloadFile 合法域名」须含该托管域名（已配·换域名时重核）。
3. **建议**：托管控制台把 `/fonts/` 路径缓存策略调长（如 max-age=31536000）——2026-07-16 实测现状
   `max-age=120` 几乎次次回源；文件名带版本号后长缓存无 stale 风险。不调也能用（客户端有本地缓存兜底）。

## 真机验收（根因#8·分层批新增项）

① 首启 FOUT 明显缩短（好网络下 splash 2s 窗口内首屏即品牌字）；② 进二级页（结算/订单/播放）文字
最终换字——iOS+安卓都看（跨族逐字回退的真机半边）；③ **二次冷启动秒出品牌字**（本地缓存·开飞行模式
重开也该有）；④ Bold 真粗（600/700 处）；⑤ 地址含「深圳」的圳字显示品牌字（GBK 二级补字）。

## 授权

OFL-1.1。其 **WebFont 特例**：仅为网页端渲染做子集化/格式转换（WOFF/WOFF2）、且不作为可安装桌面字体
提供下载时，可保留保留字名——故子集仍称 WenYuan Rounded SC。详见作者 LICENSE。
