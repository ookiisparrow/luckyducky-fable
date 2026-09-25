import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(import.meta.dirname, '../../scripts/check-cert-expiry.mjs'), 'utf8')

function defaultHosts(text) {
  const block = text.match(/const DEFAULT_HOSTS = \[([\s\S]*?)\]/)
  if (!block) throw new Error('找不到 DEFAULT_HOSTS')
  return [...block[1].matchAll(/'([^']+)'/g)].map((hit) => hit[1])
}

describe('每日证书巡逻默认清单', () => {
  it('大白话：没解析的裸域不进默认清单，四台在用的子域都在', () => {
    expect(defaultHosts(src)).toEqual([
      'www.luckyducky.cn',
      'q.luckyducky.cn',
      'kf.luckyducky.cn',
      'vod.luckyducky.cn',
    ])
  })

  it('大白话：想单独看裸域仍可把域名写在命令行，脚本不再手抄过期日', () => {
    expect(src).toMatch(/process\.argv\.slice\(2\)/)
    expect(src).not.toContain('2026-09-15')
  })
})
