#!/usr/bin/env node
// 刷新旧线冻结清单——守卫 oldline-frozen 的「有意识例外」通道（ADR §23）。
// 用途：把 next 仓止血修复同步进参照基线等场景；跑完须在提交信息写明缘由。
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { oldlineDigest } from './oldline-freeze-lib.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const files = oldlineDigest(ROOT)
const manifest = {
  note: '旧线冻结清单（守卫 oldline-frozen 对账源）——刷新走 node scripts/freeze-oldline.mjs，勿手改',
  frozenAt: new Date().toISOString().slice(0, 10),
  fileCount: Object.keys(files).length,
  files,
}
writeFileSync(resolve(ROOT, 'scripts/oldline-freeze.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`✅ 旧线冻结清单已刷新：${manifest.fileCount} 文件（scripts/oldline-freeze.json）`)
