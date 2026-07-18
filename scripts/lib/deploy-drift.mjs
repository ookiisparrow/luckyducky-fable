// 部署漂移检测（根因#8「已提交≠已部署」）：比「当前产物 hash」vs「manifest 已部署 hash」。
// 2026-06-16 实测漂移：钱链 [LD_ALERT]/支付窗口/看板修复 改了 4 天未部署，而 preflight 原只验
// dist≡cloudbaserc（结构完整）、不验「部署时效」——本模块补这洞，供 preflight 把「钱链改了未部署」拦成红。
// 纯逻辑导出供单测锁（tests/scripts/deploy-drift.test.js·反向自检），preflight 算好 hash 表后调用。
//
// 【迁活线·盲区体检批5】M5（2026-07-09）切换后生产钱链在 rewrite/cloud：网关函数 app（30 个
// action 之一，含 createOrder/pay/applyRefund/confirmReceive/cancelOrder 等，dist 按函数非按 action
// 打包、无法单独取某 action 字节）+ callbacks/payCallback + callbacks/refundCallback +
// timers/closeExpiredOrders。故 MONEY_CHAIN 降为 4 项，其中 app 是粗粒度但保守的超集代理（任何
// action 变动都会触发钱链漂移检查，宁可误报不漏判——旧线 6 项一一对应函数名的精度在新线做不到，
// 因为 createOrder/pay/applyRefund 三者已折叠进同一个 app 产物）。guard-deploy.mjs 的 SENSITIVE_FNS
// 同时含旧 6 项与 app 两套名字（并行期遗留），本模块只消费其中与 MONEY_CHAIN 同名的部分，不需要改
// guard-deploy.mjs。（观察点：app 粗粒度代理若未来 action 数继续增长，误报率会不会高到影响可用性——
// 暂未实测，留待用后视实际体验判断要不要再细化，见 docs/待办与债.md。）
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MONEY_CHAIN = ['app', 'payCallback', 'refundCallback', 'closeExpiredOrders']

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

// 给定产物根目录 distRoot 与函数名 name，算部署 hash——逐字节镜像 scripts/deploy-fns.mjs 现行部署
// 时的算法（index.js 恒有 + config.json 若存在 + package.json 若存在）。index.js 缺失（未构建/函数
// 不存在）返回 null。
//
// 为什么不与 deploy-fns.mjs 抽同一实现：openapi-perm-declared 守卫（scripts/check-structure.mjs·
// roots ['#12','#8']）用正则原文锚定 scripts/deploy-fns.mjs 自身源码（要求 `'config.json'` 字面
// 紧邻 `.update(readFileSync` 就长在该文件里），抽出会连带需要改这条守卫的匹配目标，超出本批
// （盲区体检批5）授权范围——留独立实现，靠两处头注互相指认维持一致；deploy-fns.mjs 若改了 hash
// 算法，这里也要同步改，见 docs/待办与债.md 的窄债记账。
export function hashFnDist(distRoot, name) {
  const idx = join(distRoot, name, 'index.js')
  if (!existsSync(idx)) return null
  const h = createHash('sha256').update(readFileSync(idx))
  for (const extra of ['config.json', 'package.json']) {
    const fp = join(distRoot, name, extra)
    if (existsSync(fp)) h.update(readFileSync(fp))
  }
  return h.digest('hex').slice(0, 12)
}
