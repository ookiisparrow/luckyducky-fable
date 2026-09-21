#!/usr/bin/env node
/**
 * 把「我」页版本脚日期戳成上海日历当天（YYYY-MM-DD），并按分支对齐 BUILD_CHANNEL。
 * 用法：npm run mp:stamp-version-date
 *       node scripts/stamp-mp-version-date.mjs --check   # 该戳却没戳则红（CI）
 * 接线：pre-commit、CI（PR/push → main/test）、preview:mp / device:preview / agent:preview、
 * release.mjs、mac-sync-ends。人不用记这条命令。
 *
 * 通道（老板 2026-09-18）：
 *   本仓 main → develop（开发）；本仓 test → trial（测试）；
 *   release 只由 mac-sync-ends 本地钉，不写回 git；
 *   experimental 给实验仓 luckyducky-fable-ablation，本仓不自动写。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const APP_VERSION_REL = 'rewrite/mp/lib/appVersion.ts'
const DATE_RE = /export const DEV_UPDATE_DATE = '[^']+'/
const CHANNEL_RE = /(export const BUILD_CHANNEL:[^=]+=\s*)'([^']*)'/
const CHANNELS = new Set(['', 'develop', 'trial', 'release', 'experimental'])

export function shanghaiToday(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

/** git 分支名 → 本仓该钉的通道。对不上（功能枝/实验仓）返回 null＝不改通道。 */
export function resolveStampChannel({ branch = '', baseBranch = '', envChannel = '' } = {}) {
  const env = String(envChannel || '').trim()
  if (CHANNELS.has(env) && env) return env
  const line = String(baseBranch || branch || '')
    .trim()
    .replace(/^refs\/heads\//, '')
  if (line === 'test') return 'trial'
  if (line === 'main') return 'develop'
  return null
}

export function detectGitBranch(root) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function rewriteDate(src, date) {
  if (!DATE_RE.test(src)) return null
  return src.replace(DATE_RE, `export const DEV_UPDATE_DATE = '${date}'`)
}

function rewriteChannel(src, channel) {
  if (!CHANNEL_RE.test(src)) return null
  CHANNEL_RE.lastIndex = 0
  return src.replace(CHANNEL_RE, `$1'${channel}'`)
}

export function stampMpVersion(root, opts = {}) {
  const path = join(root, APP_VERSION_REL)
  if (!existsSync(path)) {
    throw new Error('rewrite/mp/lib/appVersion.ts 缺失，版本脚戳不上')
  }
  const src = readFileSync(path, 'utf8')
  const date = shanghaiToday(opts.now)
  const channel =
    opts.channel !== undefined
      ? opts.channel
      : resolveStampChannel({
          branch: opts.branch,
          baseBranch: opts.baseBranch,
          envChannel: opts.envChannel,
        })

  let next = rewriteDate(src, date)
  if (next == null) {
    throw new Error('无法同步 rewrite/mp/lib/appVersion.ts 的 DEV_UPDATE_DATE')
  }
  if (channel != null) {
    const withCh = rewriteChannel(next, channel)
    if (withCh == null) {
      throw new Error('无法同步 rewrite/mp/lib/appVersion.ts 的 BUILD_CHANNEL')
    }
    next = withCh
  }

  const changed = next !== src
  if (changed && !opts.dryRun) writeFileSync(path, next)
  return { date, channel, changed }
}

/** 旧名：只关心日期（release.mjs / mac-sync-ends 仍用）。通道按当前 git 枝对齐。 */
export function stampMpVersionDate(root, now = Date.now()) {
  return stampMpVersion(root, {
    now,
    branch: detectGitBranch(root),
    envChannel: process.env.LD_BUILD_CHANNEL || process.env.MP_BUILD_CHANNEL || '',
    baseBranch: process.env.GITHUB_BASE_REF || '',
  }).date
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invoked) {
  const root = resolve(import.meta.dirname, '..')
  const dryRun = process.argv.includes('--check')
  const branch = process.env.GITHUB_REF_NAME || detectGitBranch(root)
  const result = stampMpVersion(root, {
    dryRun,
    branch,
    baseBranch: process.env.GITHUB_BASE_REF || '',
    envChannel: process.env.LD_BUILD_CHANNEL || process.env.MP_BUILD_CHANNEL || '',
  })
  const ch = result.channel == null ? '（通道不动）' : result.channel
  if (dryRun && result.changed) {
    console.error(`✗ 版本脚该戳成 ${result.date} / 通道 ${ch}，工作区还是旧值——跑 npm run mp:stamp-version-date 或让 hook/CI 戳`)
    process.exit(1)
  }
  if (result.changed) {
    console.log(`✅ 版本脚日期 ${result.date}，通道 ${ch}（上海日历）`)
  } else {
    console.log(`✅ 版本脚已是 ${result.date}，通道 ${ch}`)
  }
}
