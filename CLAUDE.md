# Lucky Ducky 重构样板房（平行仓）

> ## ⚠️ 本仓身份：重构样板房，不是生产仓
>
> 本仓 = 「**高纬度自动化完全重构**」（用程序哲学与美学重构整个项目）的平行工作仓，从生产仓克隆而来。
>
> - **生产仓**：`/Users/sparrow/luckyducky-miniprogram`（GitHub `ookiisparrow/luckyducky-miniprogram`）——生产事务只在那边做，本仓任何内容不自动进入生产。
> - **云环境共用、本仓禁部署**：两仓共用云环境 `cloudbase-d4gcssqbv06865479`。本仓 `scripts/guard-deploy.mjs` 已改为**拦截一切 tcb 部署/发布命令**（deny），永不解除；deploy-fns 类脚本须 `DEPLOY_ALLOWED=1`，本仓永不设置。验证全靠 vitest 内存桩 + H5 回退 + 双端 build。
> - **8 件控制台正册资产**（git 外，勿动）：微信支付连接器 `wxpay_33nb7su`、支付工作流 `sywxzfapifqzf_nncvqss2`、退款工作流 `kbgzl_n8gojr3a`、paynotify/refundnotify 及其 script1 转发节点——记录见生产仓 `docs/工作日志.md` 2026-06-12 与 `docs/调试日志.md` J；B6 批次把副本正册化进本仓 `console-assets/`。
> - **总计划**：`/Users/sparrow/.claude/plans/encapsulated-swimming-truffle.md`（v3 定稿：设计宪章三原则 + Phase A/B0–B8 批次表）。执行纪律：每批一个 squash 提交上本仓 main、`npm run check` 全绿才推进、commit 报净化指标；生产仓事务随时插队优先。
>
> 以下为克隆自生产仓的工程约定，重构过程中随批次演进。

Lucky Ducky（幸运小鸭）：钩织材料包电商 App，uni-app 一份代码发微信小程序 / H5 / App。后端微信云开发（环境 `cloudbase-d4gcssqbv06865479`、AppID `wxcbd2fb68b81bcfb1`）。

**本文件 = 全部工程约定（代码怎么写、git 怎么走、质量怎么把）。当前完成度与下一步只看 `docs/项目现状.md`，本文件不放进度。**

## 1. 文档地图

约定只在本文件；`docs/` 其余是记录与参考：

- **记录**：`项目现状.md`（事实与下一步）· `工作日志.md`（按日）· `调试日志.md`（bug 账本）· `技术债与重构.md`（欠债）· `关键决策记录.md`（为什么这么定）· `上线前占位清单.md`（占位决策追踪）。
- **参考**：`业务逻辑架构.md`（三层架构 + 集合地图 + 业务链 + 状态机，建全局心智先读）· `设计规格-课程电商系统.md` / `设计规格-管理控制台.md`（目标设计）· `微信云开发文档梳理.md`（云开发要点）· `验收手册.md`（非技术验收机制与验收单）。
- **工程**：`admin/`（管理控制台，独立 Vue3+Vite，共用云环境，见其 README）· `design/`（Pencil 设计稿）· `docs/archive/`（历史归档，含原《代码标准》《Git协作约定》全文——git 名词扫盲在后者）。

记录约定（任务收尾照做）：里程碑只更新 `工作日志.md` + `项目现状.md`；bug → 调试日志；技术债 → 技术债文档；设计变更先改设计规格再动代码；里程碑收尾附非技术验收单（模板见验收手册）。本文件只在约定 / 技术栈 / 目录变化时才改。

## 2. 技术栈与命令

uni-app + Vue 3（`<script setup>`）· JavaScript（不用 TS）· SCSS（token 在 `src/uni.scss`）· Pinia（`src/store/`）· Vite · 路由 `pages.json` · 自绘导航（`navigationStyle: custom`）。**不要擅自更换技术栈，优先沿用现有模式。**

```bash
npm install            # prepare 会自动注册 git hooks
npm run dev:h5         # H5 预览优先用这个
npm run dev:mp-weixin  # 构建后导入 dist/dev/mp-weixin
npm run check:conventions && npm run lint && npm run test   # 提交前全套（pre-commit 也会自动跑）
npm run build:h5 / build:mp-weixin
```

## 3. 质量闸（机器先把关）

四道闸已自动化，**被拦先修代码、不绕闸**：

- **编辑 hook**：改 `src/` 下 .vue/.scss 即跑 `scripts/check-conventions.mjs`，违例当场反馈。
- **pre-commit**：conventions + lint + test，红灯拦提交（npm install 后自动生效）。
- **CI**：每个 PR 跑同样三项，绿勾后用户才合并。
- **部署闸**：tcb 部署「钱/权限」云函数或托管发布 → 强制用户确认。名单在 `scripts/guard-deploy.mjs`，**新增敏感云函数要同步加进 SENSITIVE_FNS**。

确属刻意例外时在该行或上一行注释加 `convention-ok`（先确认是刻意决策再加）。ESLint 另禁 `src/` 裸 console——日志统一走 `utils/logger.js`（云函数 / admin 不限，console 即其日志机制）。

## 4. 多端硬约束

标 ⚙ 的由约定检查自动拦截：

- 只用 `uni.xxx` 跨端 API；端私有能力必须条件编译隔离（`// #ifdef MP-WEIXIN`，scss/js/template 写法各异）。
- ⚙ 不写内联 `<svg>`；图标用 `<image>` 引 `static/icons/*.svg`。
- ⚙ 本地图不走 `background-image: url()`；用 `<image>`，占位用 `MediaSlot`。
- ⚙ 避开 `backdrop-filter`、`color-mix()` 等兼容差 CSS，用近似色 / 半透明替代。
- ⚙ 交互元素用 `<view>` + `@tap`，不用 `<button>`（微信能力按钮 `open-type` 例外）。
- ⚙ 单位统一 px，不用 rpx（流式布局，与设计稿 1:1）。
- 顶部安全区 / 胶囊避让用 `utils/systemBar.js` 动态计算，不硬编码 `env(safe-area-inset-top)`。
- scoped 样式拿不到 JS 值：动态值经 `:style` 注入 CSS 变量，样式里 `var()` 取。

## 5. 目录与命名

```text
src/
  pages/          页面，每页一目录（页内自用组件放 pages/<page>/components/）
  components/     跨页复用组件（媒体大块在 components/media/）
  data/           静态样例数据，逐步换 api
  api/            请求层与业务接口
  store/          Pinia 状态（cart 购物车+结算草稿 / address / user / products / courses / progress / reviews）
  styles/         跨页公共样式（co.scss）
  utils/          工具（cloud / logger / validate / systemBar / track / format）
  static/icons/   svg 图标
  uni.scss        设计 token 单一来源
```

命名：组件 PascalCase（`ProductCard.vue`）· 页面路径小写 · JS camelCase · 常量 UPPER_SNAKE · class kebab-case（首页/通用 `ld-` 前缀，结算/订单/地址/售后/评价系列沿用 `co-` 体系）· 图标文件 kebab-case，激活态 `-on` 后缀，颜色写进 svg，组件里 `<Icon name="house" :size="20" />`（name 不带 .svg）。

## 6. 样式规则

- 颜色 / 圆角 / 间距 / 字号引 `uni.scss` 变量；不写死主题色（⚙ 与色票同值的 hex 会被拦），改主题只改 uni.scss。
- 标题排版用现有 mixin（`ld-h1` / `ld-h2`）。
- 组件样式写自己的 `<style lang="scss" scoped>`；`co-` 系列公共样式在 `src/styles/co.scss`，页面差异写页面 scoped。
- scoped 边界铁律：组件、父页面、`co.scss` 三者互相够不到；插槽内容属父级作用域。抽组件别为去重破坏边界，必要时保留少量重复原子类；同名 class 不要全局 + scoped 双写。

## 7. 数据与状态

- **商品身份单一来源 `src/data/catalog.js`**：首页产品 / 购物车与详情推荐 / 详情头部都按 id 从 catalog 派生。订单、售后里的商品是历史快照，不强行回读 catalog，但样例价格保持一致。
- **云数据（小程序端）走 `utils/cloud.js` 的 `callCloud` + 业务云函数，不走 HTTP request**。样板：`api/shop.js`（H5/App 回退本地）+ `store/products.js`（store 收口、页面从 store 取）。新模块照此三件套。
- 持久化经 `src/store/persist.js`（uni storage）：明确哪些字段需持久化；临时态（如结算草稿）不持久化；回灌必过 `sanitize` / 校验防脏数据；新增持久化补 `tests/` 用例。

## 8. 代码质量标准（自查与审核的尺子）

- **边界与依赖**：页面只编排；纯展示组件只 props/emits，不直接 import `data/*`；依赖方向 pages → components/store → api/data → utils，无循环；store 不依赖页面数据，utils 不依赖 store。
- **状态归属**：跨页进 store、页面临时态留页、组件交互态留组件。
- **副作用**：跳转 / toast / storage / timer / 请求不散进深层展示组件；timer 必清理；storage key 用常量收敛，不散字面量。
- **业务不变量**（测试优先锁这些）：数量正整数、金额有限数字、空车不结算、无地址不提交；一码一用、只能看自己激活的课、确认进课留时间戳；**价格 / 数量 / openid / 订单状态一律云函数校验，不信任前端**。
- **函数粒度**：一函数一意图，复杂流程拆 validate → mutate → side effect。
- **错误处理**：请求失败统一处理；storage 解析失败不崩（persist + sanitize）；空数据有空态；用户动作失败有反馈。
- **注释**：解释为什么而非做什么；mock / demo 行为必标注。
- **安全**：不信任 storage / query / API 输入；禁 `eval` / `v-html`；敏感信息不进日志。
- **审核分级**：P0 崩溃 / 数据错乱 / 交易错误 / 安全 ｜ P1 主流程错 / 状态不一致 ｜ P2 维护成本 / 重复 / 错位 ｜ P3 风格 / 命名 / 注释。
- **red flags**：展示组件 import data ｜ 页面专属组件躺全局 ｜ store import 页面 data ｜ 同名样式双写 ｜ storage 字面量散落 ｜ 函数又校验又改态又跳转 ｜ 金额数量未校验入库。

## 9. Git 协作

云端 GitHub 是唯一权威（私有库 `ookiisparrow/luckyducky-miniprogram`），main 是唯一长期分支：

1. **任何改动**（哪怕一行文档）都开短命分支，绝不直接改 main。
2. 一律走 PR；用户在 GitHub 异步合并——**每批独立 PR，确认合并后再开下一批**（不堆叠）。
3. squash 合并，main 历史一事一行；阶段节点打 tag（如 `v0.1`）。
4. 分支名 `feature|fix|docs|chore/xxx`；提交信息 `type：中文说明`（全角冒号，type ∈ feat / fix / docs / refactor / chore / test）。

不入库：`dist/`、`node_modules/`、`*.log`、`.DS_Store`、微信工具的 `project*.config.json`。git 名词扫盲与完整教学见 `docs/archive/Git协作约定.md`。

## 10. 调试与质量流程

1. 看 logger 输出（不靠裸 console）。
2. 现象 / 根因 / 同类隐患记 `docs/调试日志.md`；查同类问题，不只修眼前一处。
3. 能加数据契约就加；修 bug 优先补一条锁住问题的用例。
4. 跑 conventions / lint / test / build 验证；UI 调整后至少 H5 眼校，小程序问题需开发者工具或真机。

## 11. 关键决策摘要（详见 docs/关键决策记录.md，勿轻易推翻）

- uni-app 多端一份代码；px 不用 rpx；自绘浮动 TabBar（原生还原不了设计）。
- `MediaSlot` 管图位，将来换真素材只改数据或入参。
- 主题色幸运紫，变量在 `uni.scss`；Sass `@import` → `@use` 暂缓。
- 安全区用 `systemBar.js` 动态算；敏感业务全走云函数，不信前端。
- 代码按技术分层组织，不按业务链重组（决策 §17）；逻辑链整体视图看 `业务逻辑架构.md`。

## 12. 扩展套路与新会话

- 加页面：`src/pages/<name>/index.vue` + `pages.json` 注册（必要时接 TabBar / CoNavBar）。
- 加接口：`src/api/<module>.js`，返回结构贴近现有 data；页面或 store 调用。
- 加状态：`src/store/<name>.js`，按需接 persist + sanitize + 测试。
- 改主题：只改 `src/uni.scss`。

新会话先看三样：本文件 → `docs/项目现状.md` → `git status` + `git log --oneline -5`。其余文档按任务类型查（云开发 → 文档梳理 + 设计规格；修 bug → 调试日志；重构 → 技术债）。
