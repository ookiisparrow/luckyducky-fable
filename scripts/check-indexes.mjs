#!/usr/bin/env node
// 生产索引核对（运维脚本，只读面：仅调用 manager.database.describeCollection 读索引，
// 不建/改/删任何索引）。对照 console-assets/03-复合索引期望表.md 的期望态。
// 不进 npm run check（同 db-export.mjs，见 guardPlan）。用法见 docs/运维手册.md §⑥.2。
//
//   npm run db:check-indexes                          # 全量对照
//   npm run db:check-indexes -- --priority=P0          # 只查 P0
//   npm run db:check-indexes -- --collections=orders   # 只查指定集合
//   npm run db:check-indexes -- --json                 # 机器可读输出
//
// 退出码：0=无 P0 缺失；1=有 P0 缺失（发现遗漏，需要人工去控制台建）；2=拿不到凭证（未跑）。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getManager, CredentialError } from './lib/cloud-manager.mjs'
import { parseExpectedIndexes, diffIndexes } from './lib/index-check.mjs'

function parseArgv(argv) {
  const out = { json: false, priority: null, collections: null }
  for (const arg of argv) {
    if (arg === '--json') out.json = true
    else if (arg.startsWith('--priority=')) out.priority = arg.slice('--priority='.length).split(',')
    else if (arg.startsWith('--collections=')) out.collections = arg.slice('--collections='.length).split(',')
  }
  return out
}

function formatFields(fields) {
  return fields.map((f) => `${f.name}${f.dir === 1 ? '↑' : '↓'}`).join(', ')
}

async function main() {
  const { json, priority, collections } = parseArgv(process.argv.slice(2))

  const mdPath = join(process.cwd(), 'console-assets', '03-复合索引期望表.md')
  const mdText = readFileSync(mdPath, 'utf8')
  const { byCollection, warnings } = parseExpectedIndexes(mdText)

  if (warnings.length && !json) {
    console.warn(`[check-indexes] 期望表解析告警 ${warnings.length} 条（文档格式可能已漂移）：`)
    for (const w of warnings) console.warn(`  - ${w}`)
  }

  let names = [...byCollection.keys()]
  if (collections) names = names.filter((n) => collections.includes(n))

  let manager
  try {
    manager = await getManager()
  } catch (e) {
    if (e instanceof CredentialError) {
      console.error(`[check-indexes] ${e.message}`)
      process.exit(2)
      return
    }
    throw e
  }

  const report = []
  let hasP0Missing = false
  let hadReadError = false

  for (const name of names) {
    let expected = byCollection.get(name) || []
    if (priority) expected = expected.filter((e) => priority.includes(e.priority))
    if (expected.length === 0) continue

    let actualIndexesRaw = []
    let readError = null
    try {
      const info = await manager.database.describeCollection(name)
      actualIndexesRaw = info.Indexes || []
    } catch (e) {
      readError = String((e && e.message) || e)
    }

    if (readError) {
      hadReadError = true
      report.push({ collection: name, error: readError })
      continue
    }

    const { missing, extra } = diffIndexes(expected, actualIndexesRaw)
    if (missing.some((m) => m.priority === 'P0')) hasP0Missing = true
    report.push({
      collection: name,
      matchedCount: expected.length - missing.length,
      missing: missing.map((m) => ({ priority: m.priority, fields: m.fields })),
      extra: extra.map((e) => ({ name: e.Name, keys: e.Keys })),
    })
  }

  if (json) {
    console.log(JSON.stringify({ report, warnings, hasP0Missing, hadReadError }, null, 2))
  } else {
    for (const r of report) {
      console.log(`\n[${r.collection}]`)
      if (r.error) {
        console.log(`  ⚠️ 读取失败：${r.error}`)
        continue
      }
      console.log(`  ✅ 已建 ${r.matchedCount} 条`)
      for (const m of r.missing) {
        console.log(
          `  ❌ 缺失（${m.priority}）：${formatFields(m.fields)} —— 控制台：数据库 → ${r.collection} → 索引管理 → 新建复合索引`
        )
      }
      for (const e of r.extra) {
        const keyStr = (e.keys || []).map((k) => `${k.Name}:${k.Direction}`).join(',')
        console.log(`  ⚠️ 未登记的多余索引：${e.name}（${keyStr}）——核实是否遗漏登记或该删`)
      }
    }
    const tail = hasP0Missing ? '，存在 P0 缺失' : hadReadError ? '，部分集合读取失败（见上方 ⚠️，未能完整核对）' : '，无 P0 缺失'
    console.log(`\n[check-indexes] 共查 ${report.length} 个集合${tail}`)
  }

  // 读取失败与 P0 缺失都判非 0——失败必可观测（根因#14）：读不到不能悄悄汇报成"无缺失"。
  process.exit(hasP0Missing || hadReadError ? 1 : 0)
}

main().catch((e) => {
  console.error('[check-indexes] 未预期错误：', e)
  process.exit(1)
})
