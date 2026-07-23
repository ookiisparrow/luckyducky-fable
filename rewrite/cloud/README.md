# @ldrw/cloud — 云函数源码包

**一句话**：全部云函数的源码，唯一部署目标是云开发环境 `cloudbase-d4gcssqbv06865479`（生产·非沙盒）；本目录改动本身不生效，须经构建 + 人工授权部署才落地。函数数以 `build.mjs` 产物为准。

## 目录地形

```text
src/functions/
  app/         用户端聚合网关（event={action,data} 分发·action 清单以 index.ts ACTIONS 注册表为准·未知 action fail-closed 拒）
    actions/   catalog / checkpoint / cs / faq / feedback / learning / orders / reviews / user
  adminApi/    管理端网关（actions/ 逐域动作文件；customer360/ 为 provider 编排子域）
  callbacks/   微信回调：payCallback / refundCallback
  cs/          微信客服：kfCallback/ · kfMedia · kfSend
  timers/      定时：billReconcile / cleanupEvents / closeExpiredOrders / inspect / kfHealthProbe / recallScan（recallRules 为库·不独立成函数）
  ops/         运维一次性：genQrcodes / initDb / seedCourses / seedProducts
src/kit/       横切原语（下方逐文件·业务码经它、不裸调 wx-server-sdk）
src/types/     共享类型
tests/         各域测试 + kit 原语 + 契约哨兵（contract-shape.test.ts）
```

**kit/ 逐文件职责**：

- `db.ts` SDK 初始化+数据库句柄单一入口 · `gate.ts` 身份/权限闸（withOpenId/withAdminGate/isServerCall·fail-closed）· `reply.ts` 统一响应形状单源 · `validate.ts` 输入边界收口
- `transition.ts` 状态机流转原语（携合法流转表·CAS）· `ids.ts` 确定性 `_id` 幂等建档 · `paging.ts` 统一 cursor/limit 分页协议
- `throttle.ts` 限频闸（admin 防爆破/用户高频写限流）· `notify.ts` 三方支付通知防伪封装（defineNotifyCallback）
- `anomaly.ts` 异常落库收集器（防静默失败）· `observe.ts` 告警统一出口（`[LD_ALERT]`）· `botpush.ts` 企微群机器人推送单一收口 · `audit.ts` 管理端操作审计留痕 · `inspect.ts` 巡检机原语
- `inventory.ts` 成品库存原子原语（预留+乐观 CAS 防超卖）· `scmStock.ts` 原料账唯一读写口（幂等流水）
- `flow.ts` 微信退款单号契约（`out_refund_no` 字符集转换·平台接缝）· `wxpay.ts` 微信支付商户接缝（签名/请求）· `reconcile.ts` 对账原语
- `secureConfig.ts` 敏感凭证单源读取（DB 优先 env 兜底）· `contentsec.ts` 内容安全接缝 · `shipping.ts` 发货信息上传接缝 · `storage.ts` 云存储换 URL 收口 · `vod.ts` 视频点播封装 · `wecom.ts` 企业微信封装 · `csAccess.ts` 外包客服会话访问闸 · `index.ts` 桶导出

## 红线（动前必读 `CLAUDE.md` §4）

**钱链文件**（modules.json 里 orders 模块 tier=red·改动=工头级）：`app/actions/orders.ts` · `callbacks/*` · `timers/closeExpiredOrders.ts` · `timers/billReconcile.ts` · `adminApi/actions/refunds.ts`。
铁律：写库必过 kit 闸；价格/数量/openid/订单状态一律云端校验不信前端；两个网关对未知 action fail-closed。

## 常用命令

```bash
npm run build:rw-cloud                        # 构建（esbuild·产物 rewrite/cloud/dist/）
npx vitest run --project rw                   # 本包测试
DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs  # 部署＝人工授权动作（经 guard-deploy 闸）
```

## 模块归属

某 action/文件属哪个业务模块、什么危险档 → 查仓根 `modules.json`（守卫 `module-registry-complete` 焊死不重不漏）。
