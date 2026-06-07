# Lucky Ducky 小程序项目审核报告

**项目类型**: uni-app 跨端电商小程序（Vue 3 + Pinia + SCSS + Vite）  
**代码量**: ~8,138 行  
**总体评分**: 7/10（良好，开发阶段项目）  
**审核日期**: 2026-06-06

---

## 一、架构与组织

### 1.1 优势

- ✅ **清晰的项目约定**：`CLAUDE.md` 详细且权威
- ✅ **合理的目录结构**：pages / components / store / api / data / utils / styles 分离良好
- ✅ **状态管理**：Pinia 三个 store（user / cart / address），职责清晰
- ✅ **设计 Token 集中**：`uni.scss` 包含颜色/字号/圆角/间距，便于主题切换
- ✅ **组件化基础**：MediaSlot / Icon / CoNavBar 等通用组件已抽象
- ✅ **命名规范统一**：组件大驼峰、类名 ld- 前缀、变量驼峰
- ✅ **跨端兼容性意识**：只用 uni API，图标用 SVG 文件非内联

### 1.2 架构问题

#### API 层仍为空壳（P2）

**位置**: `src/api/`（70 行，4 个文件）

**问题**:
- `request.js` 基础实现完整，但 `user.js` / `shop.js` / `erp.js` / `im.js` 均为 TODO 占位
- 没有错误处理、拦截器、请求队列等常规 API 层设施
- `BASE_URL` 为空字符串

**影响**: 接后端时改动范围大，现在 mock 数据直接混在 data/ 里

**建议**:
1. 完善 `request.js`：加错误处理、超时、重试逻辑
2. 在各 api 模块实现基本请求签名（即使还是 mock）
3. 建立清晰的错误码映射

---

## 二、代码质量问题

### 2.1 P0 级别（严重）：交易流程数据一致性缺陷

#### 问题 A：结算页空草稿 fallback 样例商品

**位置**: `src/pages/checkout/index.vue:30`

```javascript
const fallback = [{ id: 'prod-1', name: '幸运小鸭礼盒 · 零基础钩织套装', tag: '经典暖黄', price: 198, qty: 1 }]
const list = ref(
  (cart.checkoutItems.length ? cart.checkoutItems : fallback).map((it) => ({ ...it, qty: it.qty || 1 }))
)
```

**问题**: 用户直接访问 `/pages/checkout` 或页面栈异常时，仍能看到并提交样例商品。违反电商交易可信原则。

**建议**:
```javascript
const list = ref(cart.checkoutItems.map((it) => ({ ...it, qty: it.qty || 1 })))

onLoad(() => {
  if (!cart.checkoutItems.length) {
    uni.showToast({ title: '购物车为空，请先选择商品', icon: 'none' })
    setTimeout(() => goBack('/pages/cart/index'), 1000)
  }
})
```

#### 问题 B：地址簿默认注入样例地址

**位置**: `src/store/address.js:16`

```javascript
list: [{ id: nextId(), ...SAMPLE_ADDRESS }],
```

**问题**: 新用户无需填写地址即可提交订单，收货信息不可信。

**建议**: 初始值改为空数组：
```javascript
list: [],
```

#### 问题 C：支付成功页订单号随机生成

**位置**: `src/pages/paysuccess/index.vue:18`

```javascript
orderNo.value = '202606061430' + String(Math.floor(Math.random() * 9000) + 1000)
```

**问题**: 订单号无法追踪、用户支付金额与订单详情无法对应、订单链路不可审计。

**建议**:
1. 结算页提交时生成订单 entity 并保存订单 ID
2. 支付成功页通过订单 ID 读取同一笔订单
3. 订单 ID 应由后端生成

---

### 2.2 P1 级别（中等）：数据流一致性问题

#### 问题 D：结算页改数量后，购物车扣减按 id 整条移除

**位置**: `src/pages/checkout/index.vue:54-55` + `src/store/cart.js:82-85`

```javascript
// 结算页允许改数量
function setItemQty(i, v) {
  list.value[i].qty = Math.max(1, v)
}

// 但 finishCheckout 按 id 删除全部
finishCheckout() {
  const ids = this.checkoutItems.map((it) => it.id)
  this.items = this.items.filter((it) => !ids.includes(it.id))
}
```

**案例**: 购物车有 `prod-1` × 3，结算页改成 × 1，提交后购物车仍清掉全部 3 件。

**建议**: 选一种一致策略
- 方案 1（推荐）：结算页不允许修改来自购物车的数量
- 方案 2：改数量同步回 checkoutItems，按改后数量扣减
- 方案 3：生成订单快照，精确按订单行数量扣减

#### 问题 E：待支付倒计时不会自动取消订单

**位置**: `src/pages/pending-pay/index.vue:22-24`

```javascript
const timer = setInterval(() => {
  secs.value = secs.value > 0 ? secs.value - 1 : 0
}, 1000)
```

**问题**: 文案写「超时订单将自动取消」但实际没实现。倒计时归零后用户仍可点"去支付"。

**建议**:
```javascript
onUnmounted(() => clearInterval(timer))

watch(() => secs.value, (v) => {
  if (v <= 0) {
    clearInterval(timer)
    uni.showToast({ title: '订单已超时取消', icon: 'none' })
    setTimeout(() => goBack(), 1500)
  }
})
```

---

### 2.3 P2 级别（低）：生命周期与行为问题

#### 问题 F：视频欢迎页过早标记「已看过」

**位置**: `src/pages/welcome/index.vue:14-15`

```javascript
onLoad(() => {
  uni.setStorageSync('ld_video_intro_seen', true)
})
```

**问题**: 用户打开欢迎页后马上关闭，也被认为已完成引导。

**建议**: 应在点击「开始学习」后再标记：
```javascript
function start() {
  uni.setStorageSync('ld_video_intro_seen', true)
  uni.redirectTo({ url: '/pages/catalog/index' })
}
```

---

## 三、构建与依赖问题

### 3.1 Sass 弃用警告

**问题**: 构建输出大量 Sass 弃用警告

```
DEPRECATION WARNING [legacy-js-api]: The legacy JS API is deprecated...
DEPRECATION WARNING [import]: Sass @import rules are deprecated in Dart Sass 3.0.0
```

**位置**: 8 个页面通过 `@import '../../styles/co.scss'` 引入公共样式

**建议**: 迁移到 `@use`，或通过 vite.config.js 全局注入：
```scss
@use '../../styles/co.scss' as *;
```

### 3.2 npm 安全漏洞

**npm audit 结果**: 8 个高危漏洞（间接依赖）

主要来源:
- `@intlify/core-base` 及相关国际化库（Vue I18n 原型污染 + XSS）
- `@dcloudio/uni-cli-shared` 链式依赖
- `esbuild` 等工具链

**当前状态**: 不影响运行（开发/演示阶段），但上线前必须处理。

### 3.3 lint 脚本问题

**位置**: `package.json`

```json
"lint": "eslint . --fix"
```

**问题**: CI / 审核时执行 `npm run lint` 会自动改代码。

**建议**: 拆分为两个脚本：
```json
{
  "lint": "eslint .",
  "lint:fix": "eslint . --fix"
}
```

---

## 四、安全性审查

### 4.1 已做好的安全措施

- ✅ 无 XSS 风险（无 `v-html` / `innerHTML`）
- ✅ 无 `eval` / `Function` 动态执行
- ✅ 图标使用 `<image>` 引 SVG（跨端安全）
- ✅ 敏感信息隔离：token / 密钥均为预留，代码里没有暴露

### 4.2 待改进

#### localStorage 密钥硬编码（P3）

**位置**: `src/pages/welcome/index.vue` 和 `src/pages/me/index.vue`

**建议**: 提取到常量文件：
```javascript
// src/const/storage.js
export const STORAGE_KEYS = {
  VIDEO_INTRO_SEEN: 'ld_video_intro_seen',
}
```

---

## 五、性能与优化

### 5.1 已有的好做法

- ✅ MediaSlot 图位抽象：集中管理，便于优化图片加载策略
- ✅ 合理的页面分割：Tab 切换用 `reLaunch` 保留内存态
- ✅ 当前数据规模不需要虚拟滚动

### 5.2 可优化方向

#### 缺少错误处理与加载态

**建议**: API 调用加 try-catch + loading 提示：
```javascript
export async function request(options = {}) {
  try {
    uni.showLoading({ title: '加载中...' })
    const res = await uni.request(...)
    uni.hideLoading()
    if (res.statusCode === 200) return res.data
    throw new Error(res.data.message || '请求失败')
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: e.message, icon: 'none' })
    throw e
  }
}
```

#### 大型页面未拆分

- `src/pages/detail/index.vue`（712 行）
- `src/pages/me/index.vue`（478 行）

**建议**: 按功能块拆分为子组件（DetailGallery / DetailPrice / DetailReviews 等）

---

## 六、数据层问题

### Mock 数据与真实流程混淆

**现象**:
- `src/data/*` 有 12 个文件样例数据
- 页面直接 import 这些数据，没有 adapter 隔离
- 接后端时每个页面都要改 import 语句

**建议**: 建立 Mock 与 Runtime 的清晰边界：
```javascript
// src/services/adapter.js
export async function getProducts() {
  if (isDev && useMock) {
    return import('@/data/products').then(m => m.PRODUCTS)
  }
  return apiShop.getProducts()
}
```

---

## 七、审核清单

| 检查项 | 结果 | 备注 |
|-------|------|------|
| ESLint 通过 | ✅ | `npm run lint` 无错 |
| H5 构建通过 | ✅ | 有 Sass 弃用警告但不阻塞 |
| 小程序构建通过 | ✅ | 已验证 mp-weixin |
| 安全扫描（XSS/eval） | ✅ | 无风险 |
| 依赖安全 | ⚠️ | 8 个高危漏洞（间接依赖） |
| 代码规范 | ✅ | 命名、注释、目录结构统一 |
| 页面功能闭环 | ✅ | 首页→详情→购物车→结算→支付完整 |
| 交易数据一致性 | ❌ | 3 个 P0 问题（样例数据混入真实流程） |
| 错误处理 | ❌ | 无 try-catch |
| 性能优化 | ✅ | 没有明显性能问题 |

---

## 八、建议行动计划

| 阶段 | 任务 | 工作量 | 收益 |
|------|------|--------|------|
| **本周** | 修复结算页 fallback 商品 | 小 | 高 |
| **本周** | 移除地址簿默认样例地址 | 小 | 高 |
| **本周** | 引入真实订单 entity，打通提交→支付→查看 | 中 | 高 |
| **下周** | 完善 API 层（错误处理、重试） | 中 | 中 |
| **下周** | npm audit fix（升级 @intlify 等） | 小 | 高 |
| **上线前** | Sass @use 迁移 | 小 | 低 |
| **上线前** | 拆分 lint:fix 脚本 | 微 | 低 |
| **上线前** | 全局错误处理与加载态 | 大 | 中 |
| **上线前** | 拆分超大页面为子组件 | 中 | 中 |

---

## 九、总结

这是一个**开发中期的高质量演示项目**，代码组织、规范、跨端兼容性都做得很好。核心风险集中在交易流程中混入了过多样例数据兜底（fallback），在接真实后端、上线前**必须清理**。

**建议流程**:
1. **本周**: 修复 P0 问题（fallback 商品、样例地址、订单号生成）
2. **下周**: 完善 API 层框架、建立 mock 隔离
3. **上线前**: npm audit fix、完整的错误处理、真实支付集成

---

**审核工具**: Qoder  
**审核完成时间**: 2026-06-06
