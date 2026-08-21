#!/usr/bin/env node
// 仓库侧健康报表（工业级缺口⑥·2026-08-02 立）：云端那侧有定时巡检（timers/inspect），
// 但**仓库侧**会静默腐烂的东西——备份新鲜度／依赖安全债／提案堆积／闸完整性——全靠人想起来才查。
// 本脚本把它们一次性摊开，一条命令：`npm run health`。
//
// 只读：不改任何文件、不碰云端、不装依赖。退出码恒 0（报表不是闸——闸是 npm run check）；
// 有红项时打印 ⚠️ 供人判断。刻意不进 npm run check（同 db-export/preflight 等运维脚本惯例）。
//
// 为什么不自动挂定时任务：每跑一次要起一个代理＝周期性花钱，属老板决策。要挂的话一条命令即可
// （omp 自带定时能力），（2026-08-21 起：挂定时与否由用户决定·原待办账已迁 GitHub Issues。）

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DAY = 86400000
const rows = []
const add = (name, ok, detail) => rows.push({ name, ok, detail })
const readSafe = (p) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) {
    return (e && e.stdout) || ''
  }
}

// ① 备份新鲜度（缺口②的监测半边）：db-export 落在哪、多久没跑了。
// 注意：本项只看「导出有没有在跑」，**证明不了备份能恢复**——恢复通路目前根本不存在（缺口②）。
{
  // 目录取自 db-export.mjs:79 的真实落点（`.db-backups.local/<timestamp>/`）——不猜路径，猜错会给假绿/假红
  const base = join(ROOT, '.db-backups.local')
  const dirs = existsSync(base) ? readdirSync(base).map((d) => join(base, d)).filter((d) => statSync(d).isDirectory()) : []
  if (!dirs.length) add('备份新鲜度', false, '`.db-backups.local/` 下无任何导出——db-export 从未跑过或已被清空（且恢复通路本就不存在·缺口②）')
  else {
    let newest = 0
    for (const d of dirs)
      for (const f of readdirSync(d)) {
        const t = statSync(join(d, f)).mtimeMs
        if (t > newest) newest = t
      }
    const days = Math.floor((Date.now() - newest) / DAY)
    add('备份新鲜度', days <= 7, `最近一次导出距今 ${days} 天` + (days > 7 ? '（>7 天·建议重跑 npm run db:export）' : ''))
  }
}

// ② 依赖安全债：npm audit 的高危/严重条数（不修，只报——修属独立批次）。
{
  const out = sh('npm', ['audit', '--json', '--audit-level=high'])
  let high = 0
  let critical = 0
  try {
    const v = JSON.parse(out).metadata?.vulnerabilities || {}
    high = v.high || 0
    critical = v.critical || 0
  } catch {
    add('依赖安全债', false, 'npm audit 输出解析失败（离线？）')
  }
  if (high || critical) add('依赖安全债', false, `high ${high} · critical ${critical} —— 见 GitHub Issue「npm audit 存量清理」`)
  else if (out) add('依赖安全债', true, '无 high/critical')
}

// ④ 闸完整性（缺口⑤的静态半边·与 tests/scripts/omp-lane-gate.test.js 同源判据的轻量版）
{
  const proj = readSafe(join(ROOT, '.omp/config.yml'))
  const home = process.env.HOME || ''
  const glob = readSafe(join(home, '.omp/agent/config.yml'))
  const mcp = readSafe(join(home, '.omp/agent/mcp.json'))
  const hook = existsSync(join(ROOT, '.omp/hooks/pre/gate-selfcheck.js'))
  const layers = [
    ['项目层', proj.includes('mcp__cloudbase_managefunctions: deny')],
    ['全局层', glob.includes('mcp__cloudbase_managefunctions: deny')],
    ['挂载层', mcp.includes('disabledServers')],
    ['钩子兜底', hook],
  ]
  const bad = layers.filter(([, ok]) => !ok).map(([n]) => n)
  add('闸四层完整性', bad.length === 0, bad.length ? `缺 ${bad.join('、')}` : '四层俱在')
}

// ⑤ 构建戳（缺口③）：dist 在的话报它出自哪个提交、是否脏构建
{
  const bi = readSafe(join(ROOT, 'rewrite/cloud/dist/BUILD-INFO.json'))
  if (!bi) add('云函数构建戳', true, 'dist 未构建（跳过）')
  else {
    try {
      const j = JSON.parse(bi)
      add('云函数构建戳', !j.dirty, `${j.sha}${j.dirty ? ' ⚠️ dirty（用未提交代码构建）' : ''} @ ${j.builtAt}`)
    } catch {
      add('云函数构建戳', false, 'BUILD-INFO.json 解析失败')
    }
  }
}

const bad = rows.filter((r) => !r.ok)
console.log('\n仓库侧健康报表（只读·非闸）\n' + '─'.repeat(52))
for (const r of rows) console.log(`${r.ok ? '✅' : '⚠️ '} ${r.name.padEnd(14)} ${r.detail}`)
console.log('─'.repeat(52))
console.log(bad.length ? `⚠️  ${bad.length} 项需要看一眼：${bad.map((r) => r.name).join('、')}` : '✅ 全部正常')
console.log('提醒：本报表证明不了「备份能恢复」——恢复演练需按 GitHub Issue「数据库备份定期化」节奏定期做。\n')
