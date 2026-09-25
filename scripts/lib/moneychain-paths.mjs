/**
 * 红区（钱链）路径清单——物理隔离单源（2026-08-21 治理减负批·用户拍板）。
 *
 * 用途：pre-commit 提交闸据此拦截——暂存文件命中任一路径且未显式设
 * `MONEYCHAIN_ALLOWED=1` 时，提交被拒。与部署闸 DEPLOY_ALLOWED 同一模式：
 * **闸拦的是「顺手误用」，拦不住刻意绕过**（刻意绕过=可见行为，走老板授权流程）。
 *
 * 范围＝orders 红模块的语义核心（云端 action/回调/kit 钱件/shared 契约/mp 交易页）；
 * admin 订单类 UI 页不在内（可视化面·错误易发现，避免日常批被闸卡死）。
 * 改这份清单＝改红区边界＝治理批，须老板拍板；守卫 rw-gates-wired 盯着本文件的关键路径没被收窄、钩子真引用它。
 */
export const MONEYCHAIN_PATHS = [
  // 云端 app 面：下单/支付/退款申请/订单读
  'rewrite/cloud/src/functions/app/actions/orders.ts',
  // 云端 adminApi 面：订单/退款/对账/账单下载
  'rewrite/cloud/src/functions/adminApi/actions/orders.ts',
  'rewrite/cloud/src/functions/adminApi/actions/refunds.ts',
  'rewrite/cloud/src/functions/adminApi/actions/reconciliation.ts',
  'rewrite/cloud/src/functions/adminApi/actions/wxbill.ts',
  // 回调：payCallback / refundCallback 整目录（防伪第一线）
  'rewrite/cloud/src/functions/callbacks/',
  // kit 钱件：支付平台接缝/状态机/库存/对账
  'rewrite/cloud/src/kit/wxpay.ts',
  'rewrite/cloud/src/kit/flow.ts',
  'rewrite/cloud/src/kit/transition.ts',
  'rewrite/cloud/src/kit/inventory.ts',
  'rewrite/cloud/src/kit/reconcile.ts',
  // shared 契约：金额品牌类型/订单域/结算规则/状态机声明
  'rewrite/shared/src/money.ts',
  'rewrite/shared/src/order.ts',
  'rewrite/shared/src/checkout.ts',
  'rewrite/shared/src/status.ts',
  // mp 交易流页面（下单→支付→售后）
  'rewrite/mp/pages/cart/',
  'rewrite/mp/pages/checkout/',
  'rewrite/mp/pages/order/',
  'rewrite/mp/pages/order-list/',
  'rewrite/mp/pages/paysuccess/',
  'rewrite/mp/pages/aftersales/',
]

/** 判定一个仓库相对路径是否命中红区 */
export function isMoneychainPath(relPath) {
  return MONEYCHAIN_PATHS.some(
    (p) => relPath === p || relPath.startsWith(p.endsWith('/') ? p : p + '/')
  )
}
