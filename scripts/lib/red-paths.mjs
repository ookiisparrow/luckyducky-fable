/**
 * 红区路径清单——提交闸的唯一名单。
 *
 * pre-commit 据此拦截：暂存文件命中任一路径且未显式设 `RED_ALLOWED=1` 时，提交被拒。
 * 与部署闸 DEPLOY_ALLOWED 同一模式：**闸拦「顺手误用」，拦不住刻意绕过**（刻意绕过＝可见行为，走老板授权）。
 *
 * 范围＝订单交易钱链的语义核心（含关单/对账定时任务）+ 运维观测与系统配置 + 云端入口与身份闸。admin 订单类 UI 页不在内
 * （可视化面、错误易发现，避免日常改动被闸卡死）。
 * 改这份清单＝改红区边界，须老板拍板；守卫 rw-gates-wired 盯着关键路径没被收窄、钩子真引用它。
 */
export const RED_PATHS = [
  // 云端入口与认证：小程序请求总入口、后台网关与登录/权限判定
  'rewrite/cloud/src/functions/app/index.ts',
  'rewrite/cloud/src/functions/adminApi/index.ts',
  'rewrite/cloud/src/functions/adminApi/lib.ts',
  // 云端 app 面：下单/支付/退款申请/订单读
  'rewrite/cloud/src/functions/app/actions/orders.ts',
  // 云端 adminApi 面：订单/退款/对账/账单下载
  'rewrite/cloud/src/functions/adminApi/actions/orders.ts',
  'rewrite/cloud/src/functions/adminApi/actions/refunds.ts',
  'rewrite/cloud/src/functions/adminApi/actions/reconciliation.ts',
  'rewrite/cloud/src/functions/adminApi/actions/wxbill.ts',
  // 云端 adminApi 面：运维观测与系统配置（凭证、配置清单、巡检、看板）
  'rewrite/cloud/src/functions/adminApi/actions/ops.ts',
  'rewrite/cloud/src/functions/adminApi/actions/configChecklist.ts',
  'rewrite/cloud/src/functions/adminApi/actions/secureConfig.ts',
  'rewrite/cloud/src/functions/adminApi/actions/dashboard.ts',
  // 钱链定时任务：超时关单回补库存、每日对账
  'rewrite/cloud/src/functions/timers/closeExpiredOrders.ts',
  'rewrite/cloud/src/functions/timers/billReconcile.ts',
  // 回调：payCallback / refundCallback 整目录（防伪第一线）
  'rewrite/cloud/src/functions/callbacks/',
  // kit：身份闸 + 钱件（支付平台接缝/状态机/库存/对账）
  'rewrite/cloud/src/kit/gate.ts',
  'rewrite/cloud/src/kit/wxpay.ts',
  'rewrite/cloud/src/kit/flow.ts',
  'rewrite/cloud/src/kit/transition.ts',
  'rewrite/cloud/src/kit/inventory.ts',
  'rewrite/cloud/src/kit/reconcile.ts',
  // shared 契约：金额品牌类型/订单域/结算规则/状态机声明/北京时间换算（订单号时间戳与对账日界由此出）
  'rewrite/shared/src/money.ts',
  'rewrite/shared/src/order.ts',
  'rewrite/shared/src/checkout.ts',
  'rewrite/shared/src/status.ts',
  'rewrite/shared/src/cst.ts',
  // mp 交易流页面（下单→支付→售后）
  'rewrite/mp/pages/cart/',
  'rewrite/mp/pages/checkout/',
  'rewrite/mp/pages/order/',
  'rewrite/mp/pages/order-list/',
  'rewrite/mp/pages/paysuccess/',
  'rewrite/mp/pages/aftersales/',
]

/** 判定一个仓库相对路径是否命中红区 */
export function isRedPath(relPath) {
  return RED_PATHS.some((p) => relPath === p || relPath.startsWith(p.endsWith('/') ? p : p + '/'))
}
