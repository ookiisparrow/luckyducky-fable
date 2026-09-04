#!/usr/bin/env node
/**
 * Mac 三端跟上：开发 / 测试 / 发布候选三个微信开发者工具目录拉最新，再戳「我」页日期。
 * 发布候选额外把 BUILD_CHANNEL 本地钉成 release（不提交）。
 * 脏工作区先 stash -u，快进失败就停，绝不强推硬撤。
 * 用法：npm run mac:sync-ends
 * 路径：环境变量 MAC_SYNC_FABLE / MAC_SYNC_TEST / MAC_SYNC_RELEASE，或 --fable/--test/--release。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stampMpVersionDate } from './stamp-mp-version-date.mjs'

export const DEFAULT_ENDS = {
  fable: {
    id: 'fable',
    label: '开发',
    path: '/Users/sparrow/luckyducky-fable',
    follow: 'main',
    envKey: 'MAC_SYNC_FABLE',
  },
  test: {
    id: 'test',
    label: '测试',
    path: '/Users/sparrow/luckyducky-test',
    follow: 'test',
    envKey: 'MAC_SYNC_TEST',
  },
  release: {
    id: 'release',
    label: '发布候选',
    path: '/Users/sparrow/luckyducky-release',
    follow: 'release',
    envKey: 'MAC_SYNC_RELEASE',
  },
}

const APP_VERSION_REL = 'rewrite/mp/lib/appVersion.ts'
const CHANNEL_RE = /(export const BUILD_CHANNEL:[^=]+=\s*)'([^']*)'/

export function pickArg(argv, name) {
  const flag = '--' + name
  const i = argv.indexOf(flag)
  if (i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) return argv[i + 1]
  const eq = argv.find((a) => a.startsWith(flag + '='))
  return eq ? eq.slice(flag.length + 1) : ''
}

export function resolveEnds(argv = process.argv, env = process.env) {
  return Object.values(DEFAULT_ENDS).map((spec) => ({
    ...spec,
    path: pickArg(argv, spec.id) || env[spec.envKey] || spec.path,
  }))
}

export function worktreeDirty(porcelain) {
  return String(porcelain || '').trim().length > 0
}

/** 跟上远端：只 checkout + ff-only / detach，不含 fetch/stash。 */
export function gitFollowPlan(follow) {
  if (follow === 'main') {
    return [
      ['checkout', 'main'],
      ['pull', '--ff-only', 'origin', 'main'],
    ]
  }
  if (follow === 'test') {
    return [
      ['checkout', 'test'],
      ['pull', '--ff-only', 'origin', 'test'],
    ]
  }
  if (follow === 'release') {
    return [['checkout', '--detach', 'origin/main']]
  }
  throw new Error('未知跟上方式：' + follow)
}

export function rewriteBuildChannel(src, channel) {
  if (!CHANNEL_RE.test(src)) {
    throw new Error('无法改写 BUILD_CHANNEL（找不到赋值行）')
  }
  CHANNEL_RE.lastIndex = 0
  return src.replace(CHANNEL_RE, `$1'${channel}'`)
}

export function pinBuildChannel(root, channel = 'release') {
  const path = join(root, APP_VERSION_REL)
  if (!existsSync(path)) {
    throw new Error(APP_VERSION_REL + ' 缺失，通道钉不上')
  }
  const src = readFileSync(path, 'utf8')
  const next = rewriteBuildChannel(src, channel)
  if (next !== src) writeFileSync(path, next)
  return channel
}

export function readBuildChannel(root) {
  const path = join(root, APP_VERSION_REL)
  const src = readFileSync(path, 'utf8')
  const m = src.match(CHANNEL_RE)
  return m ? m[2] : '?'
}

export function channelPinLabel(channel, localPin) {
  if (channel === '') return '运行时'
  return localPin ? channel + '（本地钉）' : channel
}

export function shanghaiStamp(now = Date.now()) {
  return new Date(now).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })
}

function runGit(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').trim()
    throw new Error('git ' + args.join(' ') + ' 失败' + (detail ? '：' + detail : ''))
  }
  return String(r.stdout || '').trim()
}

function syncOne(end) {
  const notes = []
  if (!existsSync(end.path)) {
    throw new Error('目录不存在：' + end.path)
  }
  runGit(end.path, ['rev-parse', '--is-inside-work-tree'])
  runGit(end.path, ['fetch', 'origin'])
  if (worktreeDirty(runGit(end.path, ['status', '--porcelain']))) {
    const msg = 'mac-sync-ends ' + shanghaiStamp()
    runGit(end.path, ['stash', 'push', '-u', '-m', msg])
    notes.push('已暂存 ' + msg)
  }
  for (const args of gitFollowPlan(end.follow)) {
    runGit(end.path, args)
  }
  const date = stampMpVersionDate(end.path)
  if (end.follow === 'release') {
    pinBuildChannel(end.path, 'release')
  }
  const sha = runGit(end.path, ['rev-parse', '--short', 'HEAD'])
  const channel = readBuildChannel(end.path)
  return {
    id: end.id,
    label: end.label,
    sha,
    date,
    channel,
    localPin: end.follow === 'release',
    notes,
  }
}

export function formatSummary(rows) {
  return rows
    .map((row) => {
      if (row.error) return row.label + '  失败：' + row.error
      const pin = channelPinLabel(row.channel, row.localPin)
      const extra = row.notes && row.notes.length ? '  ' + row.notes.join('；') : ''
      return row.label + '  ' + row.sha + '  日期 ' + row.date + '  通道 ' + pin + extra
    })
    .join('\n')
}

function main() {
  const ends = resolveEnds()
  const rows = []
  let failed = false
  for (const end of ends) {
    try {
      rows.push(syncOne(end))
    } catch (e) {
      failed = true
      rows.push({ id: end.id, label: end.label, error: e && e.message ? e.message : String(e) })
    }
  }
  console.log(formatSummary(rows))
  if (failed) process.exit(1)
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invoked) main()
