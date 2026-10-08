#!/usr/bin/env node
/**
 * 推开发版到手机，开屏标这次推送的上海时间（老板 2026-10-02：开发版每次推送都要标日期和几点·只开发版显示）。
 * 用法：npm run preview:mp（在要推的那个工作区根目录跑；先由 stamp-mp-version-date 戳版本脚日期）。
 * 流程：把「YYYY-MM-DD HH:mm」写进 rewrite/mp/lib/appVersion.ts 的 DEV_PUSH_AT → 开发者工具 cli auto-preview
 * 推到登录同一微信号的手机 → 不管成败都还原成空。推送时间只进这一次的包、不进 git（各分支合并不因时间撞车）。
 * 推手机用开发者工具老版 cli（无需令牌·2026-09-30 验证），路径同 scripts/real-device.mjs。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const APP_VERSION_REL = 'rewrite/mp/lib/appVersion.ts'
const AT_RE = /const DEV_PUSH_AT = '[^']*'/

// 上海时间 YYYY-MM-DD HH:mm（sv-SE 区域格式即 ISO 样式，同 mac-sync-ends.mjs shanghaiStamp）
export function shanghaiNow(now = Date.now()) {
  return new Date(now).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hourCycle: 'h23' }).slice(0, 16)
}

export function withPushAt(src, at) {
  if (!AT_RE.test(src)) throw new Error('appVersion.ts 里找不到 DEV_PUSH_AT，推送时间写不进去')
  return src.replace(AT_RE, `const DEV_PUSH_AT = '${at}'`)
}

/** 写入推送时间 → run()（真推送）→ 不管成败还原成空。返回写入的时间。 */
export function pushPreview(root, { now = Date.now(), run } = {}) {
  const path = join(root, APP_VERSION_REL)
  const at = shanghaiNow(now)
  writeFileSync(path, withPushAt(readFileSync(path, 'utf8'), at))
  try {
    run()
  } finally {
    writeFileSync(path, withPushAt(readFileSync(path, 'utf8'), ''))
  }
  return at
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invoked) {
  const root = resolve(import.meta.dirname, '..')
  const at = pushPreview(root, {
    run: () => execFileSync(CLI_PATH, ['auto-preview', '--project', join(root, 'rewrite/mp')], { stdio: 'inherit' }),
  })
  console.log(`✅ 已推到手机，开屏标「${at}」（只开发版显示）`)
}
