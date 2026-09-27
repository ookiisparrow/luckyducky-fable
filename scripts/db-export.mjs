#!/usr/bin/env node
// 数据备份导出（运维脚本，只读面：读集合 → 触发 manager-node 官方导出 API → 下载到本地，
// 不建/改/删任何云端资源——只读红线见批次授权，实现细节见 git 历史本批提交信息）。
// 不进 npm run check（同 deploy-fns.mjs / preflight.mjs 等既有运维脚本惯例，见 guardPlan：
// 「脚本存在性」不是摆设守卫值得守的东西）。用法见 docs/运维手册.md「备份与索引」。
//
//   npm run db:export                              # 导出 DEFAULT_COLLECTIONS
//   npm run db:export -- --collections=orders,users # 只导出指定集合
//   SECRETS_EXPORT_ALLOWED=1 npm run db:export -- --collections=secureConfig --include-secrets
//                                                   # secureConfig 只落字段名、不落值
//
// 退出码：0=全部集合成功；1=至少一个集合失败/超时，或 --include-secrets 没显式确认；2=拿不到凭证（未跑，见错误提示如何配）。
//
// 【已知偏离规格】原规格设想导出完成后调 manager.storage.deleteFile([ObjectKey]) 清理导出用
// 的 COS 临时对象——经真实类型定义核实，storage.deleteFile 内部走 storage.batchDeleteFile，
// 是「小程序 wx.cloud 云存储」桶的删除接口（cloudPathToFileId 转换），与 database.export 使用
// 的「DatabaseMigrateExport 任务」内部管理的临时 COS 对象根本不是同一命名空间——调用大概率
// 报错，且这本身是一次真实的 delete 类云端调用，与本批「绝不写/删/改云端资源」的红线冲突。
// 本实现不做该清理：临时导出对象留给腾讯云侧 DatabaseMigrateExport 任务自身的生命周期管理
// （只影响 Tencent 内部临时存储，非我方业务集合/文件），本脚本只关心下载到本地的副本。

import { mkdirSync, createWriteStream, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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

// 凭证集合只留每条的 _id 与字段名：本地明文副本就是新的泄露面，恢复时凭证回各平台重取
export function secretFieldNames(text) {
  let docs
  try {
    const t = text.trim()
    docs = t.startsWith('[')
      ? JSON.parse(t)
      : t
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l))
  } catch {
    // JSON.parse 的报错会带原文片段，不能透出
    throw new Error('导出文件解析失败，未落盘')
  }
  return docs.map((d) => ({ _id: d?._id, fields: Object.keys(d ?? {}).filter((k) => k !== '_id').sort() }))
}

const isSecretCollection = (name) => resolveCollections({ collections: name }).droppedSecrets

// 一个集合的下载结果落盘，返回本地文件路径。凭证集合按名字判、不看 --include-secrets，
// 哪条路进来都只写字段名；其余集合原样流式写
export async function saveExport(name, res, outDir) {
  if (isSecretCollection(name)) {
    const docs = secretFieldNames(await res.text())
    const file = join(outDir, `${name}.fields.json`)
    writeFileSync(file, JSON.stringify(docs, null, 2))
    console.log(`[db-export] ${name} 只写字段名：${docs.map((d) => `${d._id}(${d.fields.join(',')})`).join(' ')}`)
    return file
  }
  const file = join(outDir, `${name}.json`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
  return file
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
  if (includeSecrets && process.env.SECRETS_EXPORT_ALLOWED !== '1') {
    console.error(
      '[db-export] --include-secrets 默认拒绝：secureConfig 是明文凭证。确需导出它的字段清单（只写字段名、不写值），加 SECRETS_EXPORT_ALLOWED=1 重跑'
    )
    process.exit(1)
    return
  }
  const { list, droppedSecrets } = resolveCollections({ collections, includeSecrets })

  if (droppedSecrets) {
    console.warn('[db-export] 已从导出清单剔除 secureConfig（含明文凭证）——确需它的字段清单，加 --include-secrets 并设 SECRETS_EXPORT_ALLOWED=1')
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
        const localFile = await saveExport(name, res, outDir)
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
        // 空集合（云端 ErrorMsg「记录条数为0」）是正常现象，不算失败（8/6 首备确认）
        if (info.ErrorMsg && /记录条数为0|does not exist/i.test(info.ErrorMsg)) {
          entry.status = 'empty'
          entry.count = 0
          console.log(`[db-export] ${name} 空集合（正常，无数据可导）`)
        } else {
          entry.status = 'fail'
          entry.error = info.ErrorMsg || `未知失败（Status=${info.Status}）`
          hadFailure = true
          console.error(`[db-export] ${name} 失败：${entry.error}`)
        }
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

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => {
    console.error('[db-export] 未预期错误：', e)
    process.exit(1)
  })
}
