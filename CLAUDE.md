# Lucky Ducky 项目入口

这是 Lucky Ducky（幸运小鸭）项目的新会话入口说明。新增代码前先读本文件；详细进度、技术债、审核记录见 `docs/`。

## 1. 项目定位

Lucky Ducky 是钩织材料包电商 App，目标是支持微信小程序 / H5 / App 多端发布。后端走微信云开发（环境 `cloudbase-d4gcssqbv06865479`、AppID `wxcbd2fb68b81bcfb1`）。

**当前完成度、缺口、下一步只看 `docs/项目现状.md`（状态单一来源，本文件不重复维护）。**

## 2. 文档地图

- `docs/项目现状.md`：当前完成度、缺口、下一步。
- `docs/工作日志.md`：按日期记录项目进展。
- `docs/关键决策记录.md`：重要技术和产品决策。
- `docs/设计规格-课程电商系统.md`：微信云开发全栈目标系统设计。
- `docs/设计规格-管理控制台.md`：管理控制台（网页版：课程视频 + 二维码卡片）子规格。
- `design/`：Pencil UI 设计稿（`.pen` 源文件，用 Pencil 打开；`exports/` 为导出图）。
- `docs/代码标准.md`：审核和自查标准。
- `docs/技术债与重构.md`：技术债 backlog。
- `docs/调试日志.md`：问题、根因、同类隐患记录。
- `docs/Git协作约定.md`：分支、提交、版本、推送约定。
- `docs/验收手册.md`：非技术验收（观察窗口、黄金路径、验收单约定）。
- `docs/微信云开发文档梳理.md`：微信云开发接入要点。
- `docs/archive/`：历史归档（外部审核原始报告、`审核报告-v0.1.md` 等），结论已对账进现行文档，仅留存备查。

记录约定（每次任务收尾时照做，避免文档漂移）：

- 每个里程碑只更新两处：`docs/工作日志.md`（做了什么）+ `docs/项目现状.md`（事实与下一步）。
- 本文件（CLAUDE.md）只在约定 / 技术栈 / 目录结构变化时才改，不放进度和状态。
- bug → `docs/调试日志.md`；技术债 → `docs/技术债与重构.md`；设计变更 → 先改 `docs/设计规格-课程电商系统.md` 再动代码。
- 每个里程碑收尾时附**非技术验收单**（操作步骤 + 预期现象，用户照单验收），模板与既有验收单见 `docs/验收手册.md`。

## 3. 技术栈

- 框架：uni-app + Vue 3，使用 `<script setup>`。
- 语言：JavaScript，暂不使用 TypeScript。
- 样式：SCSS，设计变量集中在 `src/uni.scss`。
- 状态：Pinia，位于 `src/store/`。
- 构建：Vite。
- 路由：`pages.json`。
- 导航：自绘导航，`navigationStyle: custom`。

不要擅自更换技术栈。除非用户明确要求，否则优先沿用现有模式。

## 4. 常用命令

```bash
npm install
npm run dev:h5
npm run dev:mp-weixin
npm run lint
npm run format
npm run test
npm run build:h5
npm run build:mp-weixin
```

说明：

- H5 预览优先用 `npm run dev:h5`。
- 微信小程序构建后导入 `dist/dev/mp-weixin`。
- 提交前至少跑 `npm run lint`。
- 修复纯逻辑 bug 时补 `npm run test`。

## 5. 多端约束

目标端是微信小程序 / H5 / App，因此：

- 只用 `uni.xxx` 跨端 API。
- 不用某一端私有能力，除非用条件编译隔离。
- 不写内联 `<svg>`，小程序端不支持；图标用 `<image>` 引 `static/icons/*.svg`。
- 不用 `background-image: url(本地文件)` 引本地图片；本地图片用 `<image>`。
- 避开 `backdrop-filter`、`color-mix()` 等兼容性差的 CSS。
- 交互元素不要用 `<button>`，用 `<view>` + `@tap` 自定义，避免各端默认样式差异。

## 6. 目录职责

```text
src/
  pages/          页面，每个页面一个目录
  components/     跨页复用组件
  data/           静态样例数据，将来逐步替换为 api 调用
  api/            请求层和业务接口模块
  store/          Pinia 状态
  styles/         跨页面公共样式，如 co.scss
  utils/          工具函数
  static/         静态资源，static/icons 放 svg 图标
  uni.scss        设计 token 单一来源
  App.vue         根组件和全局基础样式
  pages.json      页面路由和窗口配置
  manifest.json   应用配置
```

关键文件：

- `src/data/catalog.js`：商品身份单一来源。
- `src/store/cart.js`：购物车和结算草稿。
- `src/store/address.js`：地址簿。
- `src/store/user.js`：用户资料。
- `src/store/persist.js`：跨端 Pinia 持久化插件。
- `src/utils/systemBar.js`：状态栏和微信胶囊避让。
- `src/utils/logger.js`：统一日志入口。
- `src/utils/validate.js`：数据边界校验。

## 7. 命名规范

- 组件文件用 PascalCase：`ProductCard.vue`。
- 页面路径用小写：`pages/detail/index.vue`。
- JS 变量和函数用 camelCase。
- 常量数据用 UPPER_SNAKE。
- class 用 kebab-case。
- 首页和通用组件 class 优先用 `ld-` 前缀。
- 结算、订单、地址、售后、评价等同系列页面沿用 `co-` 公共样式体系。

## 8. 样式规则

- 颜色、圆角、间距、字号优先引用 `src/uni.scss` 变量。
- 不要直接写死主题色，例如不要写 `#a371ea`，优先用 `$purple` / `$brand`。
- 标题排版用 `uni.scss` 中已有 mixin，例如 `ld-h1`、`ld-h2`。
- 单位统一用 px，不改成 rpx。
- 每个组件样式写在自己的 `<style lang="scss" scoped>`。
- `co-` 系列页面公共样式放在 `src/styles/co.scss`。
- 页面专属差异仍写在页面 scoped 样式里。

注意 scoped 样式边界：

- 组件 scoped 样式够不到父页面的 scoped 样式。
- 父页面 scoped 样式也够不到子组件内部。
- 插槽内容属于父级作用域。
- 抽组件时，不要为了“去重”破坏 scoped 边界；必要时保留少量重复原子类。

## 9. 组件规则

跨页复用组件放 `src/components/`。页内自用组件放 `src/pages/<page>/components/`。

常见分类：

- 页面区块：`Hero`、`BrandIntro`、`FeatureProducts`、`FAQ` 等。
- 卡片 / 列表项：`ProductCard`、`ReviewItem`、`OrderItem`。
- 展示块：`PriceSummary`、`RatingSummary`、`AddressBlock`。
- 基础控件：`Icon`、`MediaSlot`、`CoNavBar`、`CoSwitch`、`QuantityStepper`。
- 媒体大块：`components/media/`，视频相关优先放这里。

组件模板：

```vue
<script setup>
defineProps({ title: String })
const emit = defineEmits(['tap'])
</script>

<template>
  <view class="ld-xxx">...</view>
</template>

<style lang="scss" scoped>
.ld-xxx {
  color: $content;
}
</style>
```

## 10. 媒体和图位

非 hero 图位优先用 `MediaSlot`。当前大量图位是灰占位，将来替换真实图片、视频、动图时尽量只改数据或 `MediaSlot` 入参。

```vue
<MediaSlot ratio="1/1" label="放入图片" />
```

图标规则：

- 图标放 `src/static/icons/`。
- 文件名用 kebab-case。
- 激活态另存 `-on` 后缀。
- 颜色直接写进 svg 文件。
- 组件里用 `<Icon name="house" :size="20" />`，`name` 不带 `.svg`。

## 11. 数据规则

当前页面主要读 `src/data/*.js` 静态样例数据。接后端时：

- 在 `src/api/` 增加接口函数。
- 页面里把静态 import 换成接口请求。
- 尽量保持数据结构不变，避免大改模板。

**云开发数据**（小程序端）走 `utils/cloud.js` 的 `callCloud` + 业务云函数，不走 HTTP `request`。已有样板：`api/shop.js`（`getProducts` 接 `callCloud`，H5/App 回退本地）+ `store/products.js`（收口、页面从 store 取）。课程 / 订单照此模式。

商品身份单一来源：

- `src/data/catalog.js` 保存商品 `id/name/tag/price/was` 等身份信息。
- 首页产品、购物车推荐、详情推荐、详情头部都应从 catalog 按 id 派生。
- 订单、售后里的商品是历史快照，不强行从 catalog 读取，但样例价格应保持一致。

接口模板：

```js
import { request } from './request'

export function getProducts() {
  return request({ url: '/products' })
}
```

页面使用：

```js
import { ref, onMounted } from 'vue'
import { getProducts } from '@/api/shop'

const products = ref([])

onMounted(async () => {
  products.value = await getProducts()
})
```

## 12. 状态和持久化

Pinia store 放在 `src/store/`。

已有 store：

- `cart`：购物车、结算草稿。
- `address`：地址簿。
- `user`：登录态和用户资料。

持久化通过 `src/store/persist.js` 实现，使用 uni storage。新增持久化字段时：

- 明确哪些字段需要持久化。
- 临时态不要持久化，例如结算草稿。
- 加 `sanitize` 或校验逻辑，防止脏数据回灌。
- 必要时补 `tests/` 用例。

## 13. 调试和质量规则

遇到问题按这个顺序处理：

1. 看 logger 输出，不要只靠裸 `console`。
2. 在 `docs/调试日志.md` 记录现象、根因、同类隐患、状态。
3. 查同类问题，不只修眼前一处。
4. 能加数据契约就加。
5. 能加测试就补测试。
6. 跑 lint / test / build 验证。

规则：

- 日志统一走 `utils/logger.js`。
- 接接口数据、storage 回灌、用户输入时要做边界校验。
- 修 bug 时优先补一条能锁住问题的用例。
- UI 调整后至少 H5 眼校；小程序相关问题需要微信开发者工具或真机校验。

## 14. 关键决策摘要

已定决策，除非用户明确要求，不要轻易推翻：

- 使用 uni-app，是为了小程序 / H5 / App 一份代码多端发布。
- 使用 px，不使用 rpx，保持和设计稿 1:1。
- 使用自绘浮动 TabBar，原生 tabBar 无法还原设计。
- 使用 `MediaSlot` 管理图位，方便未来替换真实图片和视频。
- 主色统一为幸运紫，主题变量在 `src/uni.scss`。
- Sass `@import` 到 `@use` 暂缓，等待 uni-app Sass 集成更稳定后再处理。
- 小程序顶部安全区使用 `utils/systemBar.js` 动态计算，不只依赖 `env(safe-area-inset-top)`。
- 敏感业务未来走云函数，不信任前端传入的 openid、角色、价格、订单状态。

详细解释见 `docs/关键决策记录.md`。

## 15. 如何扩展

加页面：

```text
src/pages/<name>/index.vue
pages.json 注册路由
必要时接入 TabBar 或 CoNavBar
```

加接口：

```text
src/api/<module>.js
页面或 store 调用接口函数
保持返回结构贴近现有 data
```

加全局状态：

```text
src/store/<name>.js
按需接入 persist
补 sanitize / 测试
```

改主题：

```text
优先改 src/uni.scss
不要散改页面里的颜色值
```

## 16. 新会话建议

接手项目时先看三样：

1. `CLAUDE.md`（本文件，约定）
2. `docs/项目现状.md`（状态与下一步）
3. `git status` + `git log --oneline -5`（代码现场）

其余文档按任务类型按需查：接口 / 云开发 → `微信云开发文档梳理.md` + `设计规格`；修 bug → `调试日志.md`；重构 → `技术债与重构.md`。
