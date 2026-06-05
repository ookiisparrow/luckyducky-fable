# Lucky Ducky（幸运小鸭）— 项目约定

> 这是给 **Claude（以及任何协作者 / 未来的你）** 的项目说明书，也是本项目的**唯一权威约定**。
> 新增任何代码前请先读本文件，并严格遵守，以保证全项目风格统一、易维护。
>
> 🆕 **新会话必读**：请在**项目目录**（`luckyducky-miniprogram/`）里启动会话——这样本文件会被自动加载。
> 想快速接上，可直接说：「继续 Lucky Ducky 项目，先读 CLAUDE.md 和 运行说明.md」。
> 看「项目现状」知道做到哪了、看「路线图」知道下一步、看「关键决策记录」知道为什么这么做。

## 1. 这是什么项目
钩织材料包电商 App「Lucky Ducky · 创造幸运」。当前阶段：**首页打底**（其余页面后续扩展）。
设计来源是一套 HTML/React 手机原型，现已重做为 **uni-app 跨端工程**。

## ⭐ 项目现状（更新于 2026-06-06）
- ✅ **首页**：9 区块（Hero / 品牌 / 产品横滑 / 信任条 / 折叠卖点 / 买家秀 / FAQ / 结尾 / 页脚）+ 交互
  （点购买滚动定位并高亮、点搜索滚到品牌、加入弹 Toast、回到顶部、手风琴折叠）。
- ✅ **cart / me**：占位页（保证底部 Tab 可切换、不报错）。
- ✅ **工程化**：设计 token（`uni.scss`）、Pinia/`store`、`api` 空壳、`MediaSlot` 媒体槽、ESLint + Prettier。
- ✅ **构建**：H5 与 mp-weixin 均 `build` 通过。
- ⛔ 尚未做：真实数据/接口、登录/支付、其余页面、视频化图位（见路线图）。

## ⭐ 路线图（建议顺序，按性价比）
1. 产品/买家秀图位换真图（给 `MediaSlot` 传 `:src`）
2. 购物车页（`store/cart.js` + 结算入口）
3. 商品详情页
4. 微信登录 / 账号（`store/user.js` + `api/user.js`）
5. 结算 / 微信支付
6. 个人中心
7. 客服 / 企业微信 / ERP 对接（`api/im.js`、`api/erp.js`）
8. 视频教程页 + 定制播放器（`components/media/`）

## ⭐ 关键决策记录（为什么这么做，勿轻易推翻）
- **uni-app 而非原生/React/Vue**：用户要多端发布（小程序+H5+App），一份代码多端。
- **单位用 px 而非 rpx**：布局是流式的，px 与设计稿 1:1、对照学习方便、零转换风险。
- **自建浮动药丸 TabBar**：原生 tabBar 无法还原浮动药丸造型，自建组件跨端一致。
- **`MediaSlot` 媒体槽**：图位将来要换图片/视频/动图，集中一处，换时不动页面。
- **除 hero 外全灰占位**：打底阶段更干净、加载快；以后逐个换真图。
- **系统圆体替代「文源圆体」**：真字体单字重 ~14MB 不适合打包；以后 `uni.loadFontFace` 可换。
- **暂不做滚动渐显动画**：跨端+跨子组件实现复杂、收益小，优先稳定。

## 2. 技术栈（已定，勿擅自更换）
- 框架：**uni-app + Vue 3**（`<script setup>` 写法）
- 语言：**JavaScript**（不是 TS；新手友好，以后可迁移）
- 样式：**SCSS**，设计变量集中在 `src/uni.scss`（自动全局注入）
- 状态：**Pinia**（`src/store/`）
- 构建：**Vite**（CLI 工程，带 `package.json`，可进 Git）

## 3. 多端发布
目标多端：微信小程序 / H5 / App。因此：
- **只用 uni 跨端 API**（`uni.xxx`），不用某一端私有能力。
- **不要内联 `<svg>` 标签**（小程序端不支持）；图标用 `<image src="svg文件">`。
- **CSS 不要 `background-image: url(本地文件)`**（小程序端不支持引本地文件）；
  本地图片一律用 `<image>` 组件，或纯色 `<view>` 占位。
- 避开各端不兼容属性：`backdrop-filter`、`color-mix()` 等用近似色/半透明替代。

## 4. 目录结构与职责
```
src/
  pages/            页面（每个页面一个目录）：index 首页、cart 购物车、me 我
  components/       可复用组件（每个区块/控件一个 .vue）
    media/          预留：将来的定制视频播放器
  data/             静态内容数据（products/reviews/faq…）。
                    ⚠️ 以后接后端时，把这里替换成调用 src/api/，页面无需改动。
  api/              网络请求层：request.js 基础封装 + user/shop/erp/im 各模块（现为空壳）
  store/            Pinia 状态：user(账号) / cart(购物车) …（现为预留）
  static/           图片素材；static/icons/ 放 svg 图标
  uni.scss          ★ 设计 Token 单一来源（颜色/字号/圆角/间距/阴影）
  App.vue           根组件 + 全局基础样式
  pages.json        页面路由与窗口样式（navigationStyle: custom，导航自绘）
  manifest.json     应用标识与各端配置
```

## 5. 命名规范
- 组件文件：**大驼峰** `PascalCase.vue`（如 `ProductCard.vue`）。
- 组件内 class：**短横线** `kebab-case`，统一加前缀 **`ld-`**（Lucky Ducky），避免冲突。
  例：`.ld-hero`、`.ld-prod-card`。
- JS 变量/函数：**小驼峰** `camelCase`。常量数据：`UPPER_SNAKE`（如 `PRODUCTS`）。
- 页面路径全小写。

## 6. 样式规则（重要）
- **颜色、圆角、间距、字号一律引用 `uni.scss` 的 `$` 变量，禁止写死**（如不要直接写 `#A371EA`，写 `$purple`）。
  这样换主题只改一处。
- **标题排版**用 `uni.scss` 里的 mixin：`@include ld-display / ld-h1 / ld-h2;`，不要逐组件重抄字号字重。
- 单位用 **px**（本项目布局是流式的，px 已足够且与设计稿 1:1）。
  > 知识点：uni-app 还有 `rpx`（750rpx=屏宽，按屏幕等比缩放）。本项目为对照设计稿、降低出错，统一用 px。
- 每个组件样式写在自己的 `<style lang="scss" scoped>` 里。
- 交互元素**不要用 `<button>`**（各端默认样式重），用 `<view>` + `@tap` 自定义。

## 7. 组件写法模板
```vue
<script setup>
// props / emits / 逻辑
defineProps({ title: String })
const emit = defineEmits(['tap'])
</script>

<template>
  <view class="ld-xxx">...</view>
</template>

<style lang="scss" scoped>
.ld-xxx {
  color: $content; // 用变量，别写死
}
</style>
```

## 8. 图片占位：用 `MediaSlot`
非 hero 的图位**一律用 `components/MediaSlot.vue`**（现在显示灰色占位）。
将来某个图位要换成图片/视频/动图，只改这一个组件的 `type`，**页面不动**。
```vue
<MediaSlot ratio="1/1" label="放入图片" />
<!-- 以后： <MediaSlot type="video" :src="..." /> -->
```

## 9. 内容数据：放 `data/`，将来换接口
首页的产品/评价/FAQ 等都在 `src/data/*.js`。接后端时：
在 `api/shop.js` 实现请求 → 页面里把 `import 数据` 改成「请求后写入 ref」。数据结构尽量与现有一致。

## 10. 运行命令
```bash
npm install            # 安装依赖（首次）
npm run dev:h5         # 浏览器预览（最快，免微信账号）
npm run dev:mp-weixin  # 生成微信小程序，到 dist/dev/mp-weixin 用「微信开发者工具」导入
npm run lint           # ESLint 检查并自动修复（揪错）
npm run format         # Prettier 统一排版
```
详见 `运行说明.md`。

代码质量工具：**ESLint**（`eslint.config.mjs`，新版 flat config，含 uni-app 全局声明）管「对不对」，
**Prettier**（`.prettierrc.json`）管「排版」；`eslint-config-prettier` 已让两者不打架。提交前建议先 `npm run lint`。

## 11. 如何扩展（速查）
- **加页面**：`src/pages/<name>/index.vue` + 在 `pages.json` 注册；底部 Tab 在 `components/TabBar.vue`。
- **加接口**：在 `src/api/` 加/补模块，页面或 store 调用它。
- **加全局状态**：在 `src/store/` 加 `defineStore`。
- **改主题**：只改 `src/uni.scss`。

## 12. 待办（后续可做，非当前范围）
真字体接入（`uni.loadFontFace`）、购物车/详情/结算/个人中心/视频页、
微信登录、微信支付、ERP/客服/企业微信对接。
