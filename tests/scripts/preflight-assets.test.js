import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const src = readFileSync(resolve(ROOT, 'scripts/preflight.mjs'), 'utf8')

// console-assets/README.md 目录列出的正册，外加 README 自己。顺序跟 README。
const EXPECTED = [
  'README.md',
  '01-支付退款工作流.md',
  'forward-node.js',
  '02-库权限期望表.md',
  '03-复合索引期望表.md',
  '04-视频点播VOD.md',
]

function roster(text) {
  const m = text.match(/console-assets 正册齐（(\d+) 件）[\s\S]*?for \(const f of \[([\s\S]*?)\]\)/)
  if (!m) throw new Error('找不到正册齐清单')
  return {
    count: Number(m[1]),
    files: [...m[2].matchAll(/'([^']+)'/g)].map((hit) => hit[1]),
  }
}

describe('preflight 正册清单', () => {
  it('大白话：六件正册都要查，少了 03 或 04 就红', () => {
    const { count, files } = roster(src)
    expect(files).toEqual(EXPECTED)
    expect(count).toBe(files.length)
    for (const f of files) expect(existsSync(join(ROOT, 'console-assets', f)), f).toBe(true)
  })
})
