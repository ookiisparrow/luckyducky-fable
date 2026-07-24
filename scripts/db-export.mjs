#!/usr/bin/env node
// 数据备份导出（运维脚本，只读面：读集合 → 触发 manager-node 官方导出 API → 下载到本地，
// 不建/改/删任何云端资源——只读红线见批次授权，实现细节见 docs/重构日志.md 本批条目）。
// 不进 npm run check（同 deploy-fns.mjs / preflight.mjs 等既有运维脚本惯例，见 guardPlan：
// 「脚本存在性」不是摆设守卫值得守的东西）。用法见 docs/运维手册.md §⑥.1。
//
//   npm run db:export                              # 导出 DEFAULT_COLLECTIONS
//   npm run db:export -- --collections=orders,users # 只导出指定集合
//   npm run db:export -- --include-secrets          # 连 secureConfig 一起导出（慎用）
//
// 退出码：0=全部集合成功；1=至少一个集合失败/超时；2=拿不到凭证（未跑，见错误提示如何配）。
//
// 【已知偏离规格】原规格设想导出完成后调 manager.storage.deleteFile([ObjectKey]) 清理导出用
// 的 COS 临时对象——经真实类型定义核实，storage.deleteFile 内部走 storage.batchDeleteFile，
// 是「小程序 wx.cloud 云存储」桶的删除接口（cloudPathToFileId 转换），与 database.export 使用
// 的「DatabaseMigrateExport 任务」内部管理的临时 COS 对象根本不是同一命名空间——调用大概率
// 报错，且这本身是一次真实的 delete 类云端调用，与本批「绝不写/删/改云端资源」的红线冲突。
// 本实现不做该清理：临时导出对象留给腾讯云侧 DatabaseMigrateExport 任务自身的生命周期管理
// （只影响 Tencent 内部临时存储，非我方业务集合/文件），本脚本只关心下载到本地的副本。

import { mkdirSync, createWriteStream, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { getManager, CredentialError } from './lib/cloud-manager.mjs'
import { resolveCollections } from './lib/db-backup-collections.mjs'
import { PROD_ENV } from './lib/env.mjs'

function parseArgv(argv) {
  const out = { collections: null, includeSecrets: false }
  for (const arg of argv) {
    if (arg === '--include-secrets') out.includeSecrets = true
    else if (arg.startsWith('--collections=')) out.collections = arg.slice('--collections='.length)
  }
  return out
}

const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 60 // 上限 ≈2 分钟，超时记 timeout 不挂起

async function pollMigrateStatus(manager, jobId) {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const info = await manager.database.migrateStatus(jobId)
    if (info.Status === 'success' || info.Status === 'fail') return info
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return { Status: 'timeout' }
}

async function main() {
  const { collections, includeSecrets } = parseArgv(process.argv.slice(2))
  const { list, droppedSecrets } = resolveCollections({ collections, includeSecrets })

  if (droppedSecrets) {
    console.warn('[db-export] 已从导出清单剔除 secureConfig（含明文凭证）——如确需导出，加 --include-secrets')
  }
  if (list.length === 0) {
    console.error('[db-export] 集合清单为空，无事可做')
    process.exit(1)
    return
  }

  let manager
  try {
    manager = await getManager()
  } catch (e) {
    if (e instanceof CredentialError) {
      console.error(`[db-export] ${e.message}`)
      process.exit(2)
      return
    }
    throw e
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-')
  // .db-backups.local/ 命名双重豁免扫描面（零新增守卫/gitignore 编辑）：以 . 开头天然被
  // check-structure.mjs 的 SKIP_DIR 跳过；*.local 后缀天然命中
  // 既有 .gitignore 规则，导出的本地数据永不会被 git add 进这个生产源仓。
  const outDir = join(process.cwd(), '.db-backups.local', timestamp)
  mkdirSync(outDir, { recursive: true })

  const manifest = { startedAt: new Date().toISOString(), envId: PROD_ENV, collections: [] }
  let hadFailure = false

  for (const name of list) {
    console.log(`[db-export] 导出 ${name} …`)
    const entry = { name, status: 'unknown' }
    try {
      const objectKey = `tmp/db-backups/${timestamp}/${name}.json`
      const { JobId } = await manager.database.export(name, { ObjectKey: objectKey }, { FileType: 'json' })
      const info = await pollMigrateStatus(manager, JobId)

      if (info.Status === 'success' && info.FileUrl) {
        const res = await fetch(info.FileUrl)
        if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
        const localFile = join(outDir, `${name}.json`)
        await pipeline(Readable.fromWeb(res.body), createWriteStream(localFile))
        entry.status = 'success'
        entry.recordCount = info.RecordSuccess
        entry.bytes = statSync(localFile).size
        entry.localFile = localFile
        console.log(`[db-export] ${name} 成功：${info.RecordSuccess} 条，${entry.bytes} 字节`)
      } else if (info.Status === 'timeout') {
        entry.status = 'timeout'
        entry.error = `轮询超时（${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s）`
        hadFailure = true
        console.error(`[db-export] ${name} 超时`)
      } else {
        entry.status = 'fail'
        entry.error = info.ErrorMsg || `未知失败（Status=${info.Status}）`
        hadFailure = true
        console.error(`[db-export] ${name} 失败：${entry.error}`)
      }
    } catch (e) {
      entry.status = 'fail'
      entry.error = String((e && e.message) || e)
      hadFailure = true
      console.error(`[db-export] ${name} 异常：${entry.error}`)
    }
    manifest.collections.push(entry)
  }

  manifest.finishedAt = new Date().toISOString()
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  console.log('\n[db-export] 汇总：')
  for (const c of manifest.collections) {
    const countStr = c.recordCount != null ? ` (${c.recordCount} 条, ${c.bytes} 字节)` : ''
    const errStr = c.error ? ` — ${c.error}` : ''
    console.log(`  ${c.status === 'success' ? '✅' : '❌'} ${c.name}: ${c.status}${countStr}${errStr}`)
  }
  console.log(`\n[db-export] 输出目录：${outDir}`)

  process.exit(hadFailure ? 1 : 0)
}

main().catch((e) => {
  console.error('[db-export] 未预期错误：', e)
  process.exit(1)
})
