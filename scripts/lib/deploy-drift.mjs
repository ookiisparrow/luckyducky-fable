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
// 因为 createOrder/pay/applyRefund 三者已折叠进同一个 app 产物）。与部署闸无关：guard-deploy.mjs 对任何
// tcb 部署一律 ask，不按函数名分级。（观察点：app 粗粒度代理若未来 action 数继续增长，误报率会不会高到
// 影响可用性——暂未实测，留待用后视实际体验判断要不要再细化，待办见 GitHub Issues。）
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MONEY_CHAIN = ['app', 'payCallback', 'refundCallback', 'closeExpiredOrders']

// 部署账本（2026-10-02）：deploy-fns 每次真部署打一个注释 tag `deploy-<UTC时间>`，指向部署时的提交，
// 正文是 JSON {sha, deployed, functions}。取最新那个即「线上各函数是哪版」。
// 为什么不再提交 .deploy-manifest.json：部署后得记得 commit 并推 main，实际 9-29 后 5 批云端改动部署了都没记，
// 账本悄悄过时；tag 由脚本在部署那一刻打出、只推 tag，不靠人记、也不碰 main。
// 没有 tag 时退回仓根 .deploy-manifest.json 当种子（第一次打 tag 后它就不再被读，可删）。
export function readDeployLedger(root) {
  const out = execFileSync(
    'git',
    // 按名排：名字就是 UTC 时间戳、字典序＝时间序；creatordate 只到秒，同秒两 tag 分不出先后
    ['for-each-ref', '--sort=-refname', '--count=1', '--format=%(refname:short)%00%(contents)', 'refs/tags/deploy-*'],
    { cwd: root, encoding: 'utf8' },
  )
  if (out.trim()) {
    const [source, body] = out.split('\0')
    return { source, functions: JSON.parse(body).functions || {} }
  }
  const seed = join(root, '.deploy-manifest.json')
  if (existsSync(seed)) return { source: '.deploy-manifest.json（种子）', functions: JSON.parse(readFileSync(seed, 'utf8')).functions || {} }
  return { source: '（无记录）', functions: {} }
}

// 真部署前提：在 main、HEAD 就是 origin/main、工作区干净——否则发上线的不是 main 上那份代码
// （运维手册：本仓常从 worktree/分支部署；本地落后 origin 几十个提交也常见）。返回拦截理由，空＝放行。
export function deployBlockers({ branch, head, originMain, dirty }) {
  const why = []
  if (branch !== 'main') why.push(`当前在 ${branch || '游离 HEAD'}，只从 main 部署`)
  if (head !== originMain)
    why.push(`HEAD ${head.slice(0, 8)} ≠ origin/main ${originMain.slice(0, 8)}：先 git pull；本地独有提交先走 PR 合进 main`)
  if (dirty) why.push(`工作区有未提交改动：\n${dirty}`)
  return why
}

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

// 给定产物根目录 distRoot 与函数名 name，算部署 hash——这就是 scripts/deploy-fns.mjs 部署时用的算法本体
// （它直接 import 本函数）：index.js 恒有 + config.json 若存在 + package.json 若存在。index.js 缺失
// （未构建/函数不存在）返回 null。
//
// version 不参与 hash：build.mjs 把提交号写进每函数 package.json.version（`0.0.0-<sha>`），若 hash 吃
// package.json 全文，提交号一变所有函数 hash 全变，「变更待部署 N 个」恒等于全量、分不出谁真改了——这条
// hash 本为治「漏报待部署」而建，漏报变全噪同样没信号。deps/name/其余字段照旧参与
// （tests/scripts/deploy-drift.test.js 两条对锁）。
// 代价（明写）：仅提交号变而产物内容不变时不再触发重部署，线上戳会停在「上次真有内容变更」那一版——
// 内容仍是对的，只是戳不等于最新 HEAD。要让线上戳恒等 HEAD 得全量重部署换戳，值不值是部署面决策。
const stripBuildStamp = (buf) => {
  try {
    const { version: _stamp, ...rest } = JSON.parse(buf)
    return Buffer.from(JSON.stringify(rest))
  } catch {
    return buf // 非法 JSON：退回全文 hash（fail-safe——宁可多报一次，不能因解析失败静默放行内容变更）
  }
}

export function hashFnDist(distRoot, name) {
  const idx = join(distRoot, name, 'index.js')
  if (!existsSync(idx)) return null
  const h = createHash('sha256').update(readFileSync(idx))
  for (const extra of ['config.json', 'package.json']) {
    const fp = join(distRoot, name, extra)
    if (!existsSync(fp)) continue
    h.update(extra === 'package.json' ? stripBuildStamp(readFileSync(fp)) : readFileSync(fp))
  }
  return h.digest('hex').slice(0, 12)
}
