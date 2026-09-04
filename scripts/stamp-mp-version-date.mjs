#!/usr/bin/env node
/**
 * 把「我」页版本脚日期戳成上海日历当天（YYYY-MM-DD）。
 * 用法：npm run mp:stamp-version-date
 * 定版脚本 release.mjs 升号时也会跑一遍，免得发版忘改日期。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function shanghaiToday(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

export function stampMpVersionDate(root, now = Date.now()) {
  const path = join(root, 'rewrite/mp/lib/appVersion.ts')
  if (!existsSync(path)) {
    throw new Error('rewrite/mp/lib/appVersion.ts 缺失，版本脚日期戳不上')
  }
  const src = readFileSync(path, 'utf8')
  const date = shanghaiToday(now)
  const next = src.replace(
    /export const DEV_UPDATE_DATE = '[^']+'/,
    `export const DEV_UPDATE_DATE = '${date}'`,
  )
  if (next === src) {
    if (!src.includes(`export const DEV_UPDATE_DATE = '${date}'`)) {
      throw new Error('无法同步 rewrite/mp/lib/appVersion.ts 的 DEV_UPDATE_DATE')
    }
    return date
  }
  writeFileSync(path, next)
  return date
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invoked) {
  const root = resolve(import.meta.dirname, '..')
  const date = stampMpVersionDate(root)
  console.log(`✅ 版本脚日期戳为 ${date}（上海日历）`)
}
