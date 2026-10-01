// 推开发版到手机（老板 2026-10-02：开发版每次推送都要在开屏标具体日期和几点·只开发版）：
// 推前把上海时间写进 appVersion.ts 的 DEV_PUSH_AT、推完还原成空——推送时间只进这一次的包，不进 git（各分支合并不撞车）。
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { shanghaiNow, withPushAt, pushPreview } from '../../scripts/push-mp-preview.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const SAMPLE = `export const DEV_UPDATE_DATE = '2020-01-01'\nconst DEV_PUSH_AT = ''\n`

function tmpRoot(src = SAMPLE) {
  const dir = mkdtempSync(join(tmpdir(), 'mp-push-'))
  mkdirSync(join(dir, 'rewrite/mp/lib'), { recursive: true })
  writeFileSync(join(dir, 'rewrite/mp/lib/appVersion.ts'), src)
  return dir
}
const readAt = (dir) => readFileSync(join(dir, 'rewrite/mp/lib/appVersion.ts'), 'utf8').match(/const DEV_PUSH_AT = '([^']*)'/)[1]

describe('推开发版到手机：开屏推送时间', () => {
  it('大白话：时间按上海时区写「年-月-日 时:分」（UTC 17:05 是上海次日 01:05）', () => {
    expect(shanghaiNow(Date.UTC(2026, 9, 1, 17, 5, 59))).toBe('2026-10-02 01:05')
    expect(shanghaiNow(Date.UTC(2026, 0, 2, 3, 4))).toBe('2026-01-02 11:04')
  })

  it('大白话：只改推送时间那一行；找不到这一行就报错，不悄悄推一个没时间的包', () => {
    expect(withPushAt(SAMPLE, '2026-10-02 14:23')).toBe(`export const DEV_UPDATE_DATE = '2020-01-01'\nconst DEV_PUSH_AT = '2026-10-02 14:23'\n`)
    expect(() => withPushAt('export const X = 1\n', 'x')).toThrow()
  })

  it('大白话：推的那一刻包里带着时间；推完不管成败都还原成空', () => {
    const dir = tmpRoot()
    let during = ''
    pushPreview(dir, { now: Date.UTC(2026, 9, 2, 6, 23), run: () => (during = readAt(dir)) })
    expect(during).toBe('2026-10-02 14:23')
    expect(readAt(dir)).toBe('')

    expect(() =>
      pushPreview(dir, {
        run: () => {
          throw new Error('推送失败')
        },
      })
    ).toThrow('推送失败')
    expect(readAt(dir)).toBe('')
  })

  it('大白话：仓里提交的永远是空（推送时间不进 git）；npm run preview:mp 走这条推送脚本', () => {
    expect(readAt(ROOT)).toBe('')
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['preview:mp']).toContain('scripts/push-mp-preview.mjs')
  })
})
