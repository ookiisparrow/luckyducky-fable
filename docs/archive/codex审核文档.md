# Codex 审核文档

审核日期：2026-06-06

审核范围：整仓静态代码审核，重点关注交易链路、状态管理、页面流程、模块化与可维护性。

审核标准：以严谨性、优雅性、效率、可维护性为主要指标，以模块化、组件化为参考标准。

## 总体结论

当前项目具备较清晰的页面结构、Pinia 状态分层和部分公共组件抽象，H5 与微信小程序构建均可通过。但交易、地址、支付、订单链路仍明显保留原型态/演示态数据，若按真实电商小程序标准评估，当前不建议上线。

优先修复方向：

1. 移除交易链路中的样例兜底数据。
2. 建立真实订单状态模型，保证支付结果和订单详情一致。
3. 统一购物车、结算快照、提交数量、扣减逻辑。
4. 拆分 lint 与 lint:fix，清理 Sass 弃用警告。

## 主要问题

### P1：结算页在没有真实下单草稿时会自动塞入样例商品

位置：

- `src/pages/checkout/index.vue:28`
- `src/pages/checkout/index.vue:30`

问题描述：

结算页从 `cart.checkoutItems` 读取下单草稿，但草稿为空时会使用 `fallback` 商品：

```js
const fallback = [{ id: 'prod-1', name: '幸运小鸭礼盒 · 零基础钩织套装', tag: '经典暖黄', price: 198, qty: 1 }]
const list = ref(
  (cart.checkoutItems.length ? cart.checkoutItems : fallback).map((it) => ({ ...it, qty: it.qty || 1 })),
)
```

影响：

用户直接进入 `/pages/checkout/index`、页面栈异常或内存态丢失时，仍可看到并提交样例商品。这是交易链路硬错误。

建议：

草稿为空时应展示空态并引导返回购物车/首页，或直接重定向，不应创建任何可提交商品。

### P1：地址簿默认注入样例地址，导致新用户无需填写地址也能提交订单

位置：

- `src/store/address.js:15`
- `src/pages/checkout/index.vue:70`

问题描述：

地址 store 初始化时直接写入 `SAMPLE_ADDRESS`：

```js
list: [{ id: nextId(), ...SAMPLE_ADDRESS }],
```

结算页只要 `addr.value` 存在就允许继续提交，因此样例地址会进入真实下单流程。

影响：

新用户未填写地址也可以提交订单，收货信息不可信。

建议：

地址初始值应为空数组。结算页保持现有“添加收货地址”引导即可，但提交校验必须基于用户真实填写的数据。

### P1：支付成功页没有创建或读取真实订单

位置：

- `src/pages/paysuccess/index.vue:16`
- `src/pages/paysuccess/index.vue:24`
- `src/data/orders.js:9`

问题描述：

支付成功页随机生成订单号：

```js
orderNo.value = '202606061430' + String(Math.floor(Math.random() * 9000) + 1000)
```

“查看订单”固定跳转到静态待发货页：

```js
uni.reLaunch({ url: '/pages/order/index?status=toship' })
```

订单页数据来自 `src/data/orders.js` 的静态样例。

影响：

用户支付金额、订单号、订单详情无法对应，订单链路不可审计。

建议：

提交订单时应生成订单实体并保存订单 id，支付成功页通过订单 id 读取同一笔订单。静态样例数据只能用于 demo，不应接入真实流程。

### P2：结算页改数量后，购物车扣减逻辑仍按商品 id 整条移除

位置：

- `src/pages/checkout/index.vue:53`
- `src/store/cart.js:82`

问题描述：

结算页允许用户修改 `list` 中的数量，但 `cart.finishCheckout()` 只按商品 id 删除购物车条目：

```js
const ids = this.checkoutItems.map((it) => it.id)
this.items = this.items.filter((it) => !ids.includes(it.id))
```

影响：

例如购物车有 3 件，结算页改成 1 件并提交，购物车仍会清掉全部 3 件。

建议：

选择一种一致策略：

1. 结算页不允许修改来自购物车的数量。
2. 修改数量同步回结算草稿，并按提交数量扣减购物车。
3. 提交时生成订单后以订单快照为准，同时购物车按订单行精确扣减。

### P2：待支付倒计时不会自动取消订单

位置：

- `src/pages/pending-pay/index.vue:20`

问题描述：

倒计时归零后只保持 `secs = 0`，页面仍可停留且“去支付”仍可点击：

```js
const timer = setInterval(() => {
  secs.value = secs.value > 0 ? secs.value - 1 : 0
}, 1000)
```

影响：

UI 文案写着“超时订单将自动取消”，实际行为没有实现，用户可能在过期订单上继续支付。

建议：

倒计时归零时应触发订单取消状态、禁用支付按钮、停止定时器，并提示用户返回或重新下单。

### P3：视频欢迎页过早标记“已看过”

位置：

- `src/pages/welcome/index.vue:13`

问题描述：

欢迎页在 `onLoad` 时就写入：

```js
uni.setStorageSync('ld_video_intro_seen', true)
```

影响：

用户打开欢迎页后马上关闭，也会被认为已完成引导，后续不会自动看到欢迎流程。

建议：

应在点击“开始学习”后再写入 storage。

### P3：lint 脚本默认自动修复，不适合作为审核/CI 命令

位置：

- `package.json:16`

问题描述：

当前脚本：

```json
"lint": "eslint . --fix"
```

影响：

审核或 CI 执行 `npm run lint` 会自动改代码，容易把验证行为和代码修改混在一起。

建议：

拆成：

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix"
```

### P3：Sass `@import` 已弃用，构建持续产生警告

位置示例：

- `src/pages/checkout/index.vue:218`
- `src/pages/profile-edit/index.vue:87`
- `src/pages/address/index.vue:64`
- `src/pages/review/index.vue:122`
- `src/pages/address-edit/index.vue:112`
- `src/pages/aftersales/index.vue:74`
- `src/pages/order/index.vue:164`
- `src/pages/pending-pay/index.vue:151`

问题描述：

多个页面通过：

```scss
@import '../../styles/co.scss';
```

引入公共样式。构建输出提示 Sass `@import` 将在 Dart Sass 3.0.0 移除。

影响：

目前不阻断构建，但会持续污染构建日志，并在未来 Sass 升级时产生维护成本。

建议：

评估迁移到 `@use`，或通过 uni-app/Vite 样式注入机制统一引入公共样式。

## 设计与维护性观察

### 状态持久化不足

购物车、地址、用户资料、结算草稿均主要存在 Pinia 内存态中。当前 Tab 切换可保留，但刷新、冷启动、异常跳转会丢失关键状态。

建议：

对购物车、地址、用户资料等用户输入型状态做本地持久化或后端同步。结算草稿则应使用明确的订单草稿 id 或可验证快照，不应依赖隐式内存状态。

### 页面仍有明显原型态数据

订单、待支付、售后、评价、支付成功等页面仍使用静态样例数据。这对视觉还原有帮助，但应隔离在 mock 层，避免直接进入真实业务路径。

建议：

建立 `mock` 与 `runtime` 的边界，例如：

- `src/data/*` 只用于 demo 或开发环境。
- 页面层统一通过 service/api 读取数据。
- mock 数据由 adapter 提供，便于后续替换真实接口。

### 公共组件抽象已有基础，但交易组件还可继续收敛

`CoNavBar`、`MediaSlot`、`Icon` 已经降低了重复，但订单金额明细、地址卡、商品行、底部提交坞在多个页面仍重复度较高。

建议：

优先抽取这些业务稳定组件：

- `AddressCard`
- `OrderItemRow`
- `PriceSummary`
- `BottomActionDock`

抽象边界应围绕业务语义，而不是只抽样式片段。

## 验证记录

已执行：

```bash
npm run lint
npm run build:h5
npm run build:mp-weixin
```

结果：

- `npm run lint` 通过。
- `npm run build:h5` 通过。
- `npm run build:mp-weixin` 通过。
- 构建存在 Sass deprecation warning，未阻断构建。

## 修复优先级建议

1. 修复结算页空草稿 fallback 商品问题。
2. 移除地址簿默认样例地址。
3. 引入真实订单草稿/订单实体，打通提交订单、支付成功、查看订单。
4. 修复购物车数量扣减与结算数量不一致。
5. 修复待支付超时行为。
6. 拆分 lint 脚本，清理 Sass `@import` 警告。
7. 按业务语义继续抽取订单/地址/金额组件。
