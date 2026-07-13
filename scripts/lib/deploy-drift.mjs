// 部署漂移检测（根因#8「已提交≠已部署」）：比「当前产物 hash」vs「manifest 已部署 hash」。
// 2026-06-16 实测漂移：钱链 [LD_ALERT]/支付窗口/看板修复 改了 4 天未部署，而 preflight 原只验
// dist≡cloudbaserc（结构完整）、不验「部署时效」——本模块补这洞，供 preflight 把「钱链改了未部署」拦成红。
// 纯逻辑导出供单测锁（tests/scripts/deploy-drift.test.js·反向自检），preflight 算好 hash 表后调用。
//
// ⚠️ 作用面（M5 切换后·深审 P2 纠错）：下方 MONEY_CHAIN 是**旧线独立函数名**，preflight 也只算
// packages/cloud/dist（冻结旧线·hash 永不变→该检查恒绿）。M5（2026-07-09）切换后生产钱链在
// **rewrite/cloud**（app 内 createOrder/pay action + callbacks/payCallback + refundCallback + timers/
// closeExpiredOrders），旧线 26 函数已删。故本模块对**生产线钱链部署漂移零检测**——是历史遗留的旧线参照，
// 别把这里的绿灯当「生产钱链已部署」的保证。生产线 deploy-drift 属未闭合债（需 rewrite 部署清单
// .deploy-manifest-rw + deploy 时回填 sha），见 docs/待办与债.md。

// 钱链函数（旧线名·参照）。≡ guard-deploy.mjs SENSITIVE_FNS 的钱链段（前 6 个）——改动两处同步（暂未抽
// 共享模块：guard-deploy 是每次 Bash 调用的 PreToolUse 钩子、改它有锁死风险，故保守不动其 runtime）。
export const MONEY_CHAIN = [
  'createOrder',
  'pay',
  'payCallback',
  'applyRefund',
  'refundCallback',
  'closeExpiredOrders',
]

// 纯逻辑：给「当前产物 hash 表 cur」「已部署 hash 表 deployed」，返回 fns 中有漂移项的描述数组。
// cur[fn] 缺＝产物没打出来（构建漏产）；deployed[fn] 缺＝该函数从未部署；两者不等＝代码领先部署。
// 空数组＝无漂移（部署态≡代码态）。
export function detectDrift(cur, deployed, fns) {
  const drift = []
  for (const fn of fns) {
    if (!cur[fn]) {
      drift.push(`${fn}(产物缺)`)
      continue
    }
    if (cur[fn] !== deployed[fn]) drift.push(`${fn}(${deployed[fn] || '未部署'}→${cur[fn]})`)
  }
  return drift
}
