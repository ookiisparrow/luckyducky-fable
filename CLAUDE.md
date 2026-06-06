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
- ✅ **商品详情页**（`pages/detail`，方案 A 经典电商）：浮层返回/分享 + 画廊缩略 + 价格卡 + 规格/服务 + 难度耗时 + 评价(评分分布/标签/前2条) + 图文详情(参数表) + 套装包含 + 为你推荐 + 固定底部购买坞。由首页产品卡 `uni.navigateTo` 带 `id/name` 进入。数据在 `data/productDetail.js`。
  - 图位全走 MediaSlot 灰占位；图标用 `static/icons/` 新增 11 个 svg（kit/stat 紫色、客服/收藏 content 色、分享白色；幸运卡用 `sparkles-purple` 与首页 ink 版区分）。
  - ⚠️ **本页内为样例数据、单一商品**：不同商品点进来内容相同（仅标题用所点商品名）。规格选择/全部评价/立即购买(结算)/分享 暂为 Toast 占位，待后续接。
  - 决策：详情页强调色用 `$purple`（与页内紫色「立即购买」按钮一致，贴合原型 live 主色）；注意这与首页加购按钮用的 `$brand` 蓝 不同——见关键决策记录待办。
- ✅ **购物车页**（`pages/cart`）：由 `store/cart.js`（Pinia）真实驱动 —— 空车态/有货态、条目选择、数量增减（减到 1 再减→确认移除）、全选、选中合计、浮动「去结算」栏。详情页/购物车推荐位「加入购物车」真正入车（按 id 合并 +1）。数据 `data/cart.js`（为你推荐）。「去结算」暂 Toast 占位（结算页是下一步）。强调色用 `$purple`。
  - 说明：Tab 用 `uni.reLaunch` 切页但不重启 JS，故 cart store 内存态在三 Tab 间保留；加购后切购物车即见。
- ✅ **结算页 + 支付成功页**（`pages/checkout`、`pages/paysuccess`）：地址(样例) + 店铺/商品(可改数量) + 搭配购买(勾选+数量) + 配送/优惠/积分/备注(展示) + 金额明细(实时联动) + 固定提交坞；提交→支付成功页(成功标+实付+订单号+两个出口)。
  - **下单闭环已通**：详情→加购→购物车→去结算→提交→支付成功→返回首页；详情「立即购买」单件直购也走同一结算页。结算入口的清单经 cart store 的「结算草稿」(`checkoutItems`/`checkoutFromCart`)传递；来自购物车的条目提交后从车里移除。数据 `data/checkout.js`。
  - ✅ **收货地址已接通地址簿**：结算页地址来自 `store/address.js` 的默认地址；无地址→空态「添加收货地址」、有→点进地址管理选/改；提交时无地址会拦下去新增。
  - ⚠️ **占位**：配送/优惠券/积分/备注为展示+Toast、「查看订单」Toast、**无真实微信支付**(提交即视为成功)。
- ✅ **「我」个人中心主页**（`pages/me`，学习中枢版）：紫色资料头(头像/名/手机/简介/编辑) + 继续学习视频卡(进度) + 我的订单九宫格(待支付/待发货/待收货/已完成/退款，带角标) + 客服/地址 列表。数据 `data/profile.js`。
  - **真接通**：「继续观看 / 全部教程」跳已做好的 `player` / `catalog` 页。
  - ⚠️ **占位（子流程后续做）**：编辑资料、订单各状态页、全部订单、客服 均 Toast；继续学习进度为样例(无真实观看记录)。
- ✅ **地址簿**（`pages/address` 管理 + `pages/address-edit` 编辑/新增，`store/address.js`）：列表/设默认/编辑/删除/新增，受控表单 + 设为默认开关。初始播一条样例地址(可删)。被「我的页·地址管理」与「结算页·收货地址」共用。
- ✅ **工程化**：设计 token（`uni.scss`）、Pinia/`store`、`api` 空壳、`MediaSlot` 媒体槽、ESLint + Prettier。
- ✅ **构建**：H5 与 mp-weixin 均 `build` 通过。
- ✅ **视频教程流程（保底版）**：欢迎页(变体A) → 课程目录 → 播放页（分段进度 / 段末自动暂停 / 0.5×慢放 / 单段循环 / 进度点按跳转 / 后退10s）+ 求助面板（常见问题内联；客服/社群/反馈为占位）。页面：`pages/welcome`、`pages/catalog`、`pages/player`；数据 `data/course.js`。播放器用真实 `<video>` 自绘控件、非全屏铺满（保同层渲染）。
  - ⚠️ **待复核**：播放页有一个用户早前发现、我"盲修"过（进度点按/时长两处）的交互问题，**具体现象未明确**，需再验。
  - ⚠️ **待真机验**：小程序端「同层渲染叠加控件」「0.5×慢放」是否生效（H5 可编译运行；我无法驱动微信开发者工具）。
  - 占位示例视频用外链 mp4；小程序需配合法域名或勾「不校验合法域名」。
- ⛔ 尚未做：真实数据/接口、登录、**真实微信支付**、个人中心、视频化图位（见路线图与「产品探索书签」）。

> 🔄 **保持同步**：每完成一个里程碑，先更新本节再 `git commit`。新会话可用 `git log -1 --oneline`
> 看最近提交、确认"文档是否随代码一起更新过"——这是判断本节是否最新的最简单方法。

## ⭐ 路线图（建议顺序，按性价比）
1. 产品/买家秀图位换真图（给 `MediaSlot` 传 `:src`）
2. ~~购物车页（`store/cart.js` + 结算入口）~~ ✅ 已完成（见现状）
3. ~~商品详情页~~ ✅ 已完成（`pages/detail`，方案 A；见现状）
4. 微信登录 / 账号（`store/user.js` + `api/user.js`）
5. ~~结算页~~ ✅ 已完成（UI + 闭环，见现状）；**真实微信支付**仍待做（需商户资质/后端）
6. 个人中心：主页 + 地址簿 ✅ 已完成；子流程待做（订单状态/待付款/售后/评价/资料编辑）
7. 客服 / 企业微信 / ERP 对接（`api/im.js`、`api/erp.js`）
8. 视频教程页（**保底版已完成**，见现状）；未来定制方向见「产品探索书签」（计数陪伴 / AI 点数）

> 顺序可调：若**暂无真实产品图**，可先做 ②购物车页，第①步随时回补——互不阻塞。

## ⭐ 产品探索书签（已讨论 · 待推进，勿丢失）
- **已验证的真实新手痛点**：数错针 / 看不懂针目 / 记错针数（= 计数 · 识别 · 记忆）。
- **关键洞察**：这是"计数/状态"问题，**视频再好也只能解决'看不懂'的一半**，解决不了数错/记错。
- **候选承重柱（暂缓）**：交互式「**计数陪伴**」——app 替你数针/记进度 + 每一步"针目特写"参照；视频降为喂参照的素材。
- **登月级（待可行性 spike）**：AI 视觉点数（拍照识别并数针），可行性未知。
- **当前决定（本阶段）**：先把现有视频 UI 交互**做完作为保底方案**；以上方向以后再推进。
- 已知：高质量钩织视频已验证可产出（不是瓶颈）；当前在"方案探索期"，不锁死。

## ⭐ 关键决策记录（为什么这么做，勿轻易推翻）
- **uni-app 而非原生/React/Vue**：用户要多端发布（小程序+H5+App），一份代码多端。
- **单位用 px 而非 rpx**：布局是流式的，px 与设计稿 1:1、对照学习方便、零转换风险。
- **自建浮动药丸 TabBar**：原生 tabBar 无法还原浮动药丸造型，自建组件跨端一致。
- **`MediaSlot` 媒体槽**：图位将来要换图片/视频/动图，集中一处，换时不动页面。
- **除 hero 外全灰占位**：打底阶段更干净、加载快；以后逐个换真图。
- **系统圆体替代「文源圆体」**：真字体单字重 ~14MB 不适合打包；以后 `uni.loadFontFace` 可换。
- **暂不做滚动渐显动画**：跨端+跨子组件实现复杂、收益小，优先稳定。
- **⚠️ 待统一：主色 蓝 vs 紫**。原型运行态把 `--brand` 覆盖成紫 `#A371EA`，但本工程 `uni.scss` 的 `$brand` 取了 CSS 默认蓝 `#0052D9`，首页加购按钮因此是蓝色（偏离原型 live 的紫）。商品详情页为页内自洽（「立即购买」本就是紫）选用了 `$purple`。**结果：首页加购=蓝、详情强调=紫，全局不一致。** 需用户拍板统一成蓝还是紫（一处改 `uni.scss`）。

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
- **图标命名约定**：`src/static/icons/` 下用 `kebab-case`（如 `shopping-cart.svg`）；颜色直接烤进 svg；
  激活态另存 `-on` 后缀文件（如 `house.svg` / `house-on.svg`）。组件里用 `<Icon name="house" :size="20" />`（`name` 不带 `.svg`）。

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

### 4.1 组件分类（新增组件时照此归类，放进 `src/components/`）
- **页面区块**（整屏一段）：`Hero` / `BrandIntro` / `FeatureProducts` / `TrustStrip` / `Reassurance` / `Reviews` / `FAQ` / `ClosingCTA` / `SiteFooter`
- **卡片**（列表里的一项）：`ProductCard` / `ReviewCard`
- **基础控件**（跨页面复用的小件）：`Icon` / `MediaSlot` / `Accordion` / `TabBar` / `Toast` / `BackTop`
- **媒体**：`components/media/`（将来的定制视频播放器）
> 现阶段组件平铺在 `components/` 下即可；数量变多再按上面分类建子目录。

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

### 9.1 接口调用模板（接后端时照此写）
请求层签名见 `src/api/request.js`：`request({ url, method, data })`（**不是** `request.get`）。
```js
// 1) src/api/shop.js —— 用 request 实现一个接口
import { request } from './request'
export function getProducts() {
  return request({ url: '/products' }) // GET 默认；POST 时传 { url, method: 'POST', data }
}

// 2) 页面里：把「直接 import 静态数据」换成「请求后写入 ref」
import { ref, onMounted } from 'vue'
import { getProducts } from '@/api/shop' // 原来是 '@/data/products'
const products = ref([])
onMounted(async () => {
  products.value = await getProducts()
})
```
> 关键：数据结构保持和 `src/data/*.js` 一致，这样模板 `v-for` 一行都不用改。

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
