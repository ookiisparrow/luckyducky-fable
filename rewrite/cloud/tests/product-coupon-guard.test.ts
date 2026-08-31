import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { COUPON } from '@ldrw/shared'

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|vue|wxml|js|mjs|md)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('商品券边界（本批不变量）', () => {
  it('大白话：现网占位抵扣仍是 20，没改金钱计算', () => {
    expect(COUPON).toBe(20)
  })

  it('大白话：活线不接商家券创建、不接小程序发券插件', () => {
    const roots = ['rewrite/cloud/src', 'rewrite/mp', 'rewrite/admin/src']
    const hits: string[] = []
    for (const root of roots) {
      for (const f of walk(join(process.cwd(), root))) {
        if (f.includes('/tests/')) continue
        const t = readFileSync(f, 'utf8')
        if (t.includes('busifavor') || t.includes('sendCoupon') || t.includes('wxf3f436ba9bd4be7b')) hits.push(f)
      }
    }
    expect(hits).toEqual([])
  })

  it('大白话：商品券出站只从 kit/wxbrand 走，回调草稿不碰 paynotify', () => {
    const kit = readFileSync(join(process.cwd(), 'rewrite/cloud/src/kit/wxbrand.ts'), 'utf8')
    expect(kit).toContain('/brand/marketing/product-coupon/')
    expect(kit).not.toContain('busifavor')
    const notify = readFileSync(join(process.cwd(), 'rewrite/cloud/src/functions/callbacks/couponNotify/index.ts'), 'utf8')
    expect(notify).toContain('verifyBrandNotify')
    expect(notify).toContain('confirmProductCoupon')
    expect(notify).not.toMatch(/payCallback|refundCallback|refundnotify/)
    expect(notify).not.toContain('defineNotifyCallback')
  })
})
