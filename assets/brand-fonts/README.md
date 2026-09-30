# 品牌字体（文源圆体 WenYuan Rounded SC · 分层子集 WebFont）

这里是**小程序按钮/标题/界面固定文案（`--v5-font-brand`）的分层子集 WebFont 产物**，经 `wx.loadFontFace` 远程
分层加载（`rewrite/mp/utils/brandFont.ts`）——**不进 src、不打进小程序包**（守卫 `rw-mp-package-budget`）。

## 文件（v10）

| 层 | 覆盖 | 文件 |
|---|---|---|
| tier1 | tab 首屏（home/cart/me 闭包+tabBar+splash+seed 商品/课程标题）+ASCII+标点 | `wenyuan-tier1-{medium,bold,heavy}.v10.woff` |
| tier2 | 其余二级页闭包 | `wenyuan-tier2-{medium,bold,heavy}.v10.woff` |

字数与体积以构建输出为准（`node scripts/build-brand-font.mjs` 会打印）。

只收**真用圆体显示**的字（v5·老板 2026-09-28 拍板）：圆体只留给按钮、标题、界面固定文案；正文长段、
13px 及以下的辅助小字（按键除外）和用户内容（昵称/收件人/地址/评价/输入框）走黑体 `.t-sys`，系统弹窗/提示
是系统字——这些字都不收，所以也不设 GB2312 兜底层。

字重：Medium 500（正文）/ Bold 700（标题）/ Heavy 900（首屏与结果页大标题），两层都出三档。设计稿的 Light 300
只用在辅助小字上，小字走黑体，圆体不出细体（按键上的小字用 500）。

- `tier{1,2}.txt` — 各层字符集正本（构建产物·与 woff 同批出·**勿手改**——守卫
  `rw-mp-font-tier-subset-covers` 只读 txt，txt 新 woff 旧＝守卫绿但真机缺字）。
- `LICENSE` — SIL OFL-1.1 全文 + 版权（随字体分发的授权条件③）。

> ⚠ 用 **woff** 不用 woff2：`wx.loadFontFace` 官方建议格式仅 TTF/WOFF，woff2 开发者工具能渲染（假绿）
> 真机静默失败（根因#8）。
> ⚠ 文件名带版本号（`.v10`）：字符集/分层变更＝版本 +1＝新文件名＝CDN 与本地缓存天然失效。
> 版本常量在 `scripts/build-brand-font.mjs`（`V`），须与 `rewrite/mp/utils/brandFont.ts` 文件名同步改。

子集外的字、字体到达前，自动回退：tier1 缺的字 → tier2 → 系统字（CSS 逐字回退·
`rewrite/mp/styles/tokens.wxss` 的 `--v5-font-brand`）。

## 怎么来的 / 怎么重建

源 OTF（84MB·OFL-1.1·不入仓）来自作者发布：https://github.com/takushun-wu/WenYuanFonts

```bash
# 前置：pip install fonttools brotli（提供 pyftsubset）
BRAND_FONT_SRC=/path/to/otf-dir node scripts/build-brand-font.mjs
```

分层字符集**从仓内代码推导**（单源 `scripts/lib/brand-font-charset.mjs`·tab 闭包/二级页闭包）。
新增文案带来子集外新字时守卫 `rw-mp-font-tier-subset-covers` 会红并点名——重跑构建、提交新产物
（txt+woff 全套）、按下节重新部署。

## 部署（靠人·控制台）

1. 全部 `.woff` 传到 CloudBase 静态托管 `/fonts/` 下。旧版本文件等线上小程序换到新版本后再删（线上版本读哪一版看 main 的 `brandFont.ts`）（URL 单源 `rewrite/mp/utils/brandFont.ts`）。
2. 小程序后台「downloadFile 合法域名」须含该托管域名（已配·换域名时重核）。
3. **建议**：托管控制台把 `/fonts/` 路径缓存策略调长（如 max-age=31536000）：文件名带版本号，长缓存无 stale 风险。不调也能用（客户端有本地缓存兜底）。

## 真机验收（字体变更后·根因#8）

① 首启 FOUT 明显缩短（好网络下 splash 2s 窗口内首屏即品牌字）；② 进二级页（结算/订单/播放）文字
最终换字——iOS+安卓都看（跨族逐字回退的真机半边）；③ **二次冷启动秒出品牌字**（本地缓存·开飞行模式
重开也该有）；④ Bold 真粗（600/700 处）；⑤ 昵称、地址、评价、输入框是黑体，同一行里不混两种字。

## 授权

OFL-1.1。其 **WebFont 特例**：仅为网页端渲染做子集化/格式转换（WOFF/WOFF2）、且不作为可安装桌面字体
提供下载时，可保留保留字名——故子集仍称 WenYuan Rounded SC。详见作者 LICENSE。
