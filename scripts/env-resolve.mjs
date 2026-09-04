#!/usr/bin/env node
/**
 * 环境选择子 dry-run（Issue #106）——不连云、不读密钥。
 * 用法：
 *   node scripts/env-resolve.mjs
 *   node scripts/env-resolve.mjs --target stub|test|prod-readonly
 *   node scripts/env-resolve.mjs --env <已入册 envId>
 */
import { parseTargetFromArgv, resolveTarget, listTargets } from './lib/env.mjs'

function print(entry) {
  const row = {
    selector: entry.selector,
    label: entry.label,
    envId: entry.envId,
    gitBranch: entry.gitBranch,
    writes: entry.writes,
    cloud: entry.cloud,
    may: entry.may,
  }
  if (entry.note) row.note = entry.note
  console.log(JSON.stringify(row, null, 2))
}

const raw = parseTargetFromArgv(process.argv, process.env)
if (!raw && !process.argv.includes('--target') && !process.argv.includes('--env')) {
  console.log('# 云环境目录（无密钥）· 真值 scripts/lib/env.mjs')
  for (const t of listTargets()) print(t)
  process.exit(0)
}

try {
  print(resolveTarget(raw))
} catch (e) {
  console.error('✗ ' + (e && e.message ? e.message : e))
  process.exit(1)
}
