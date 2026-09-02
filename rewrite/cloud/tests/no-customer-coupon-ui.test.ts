// 主线顾客页禁展示优惠券（2026-09-02 老板明令）：开发版/发布版不得出现「优惠券」行。
// 真券/领取只在 git test / yaliceshi，禁止合进 main。mp 测试进不了 node:fs（tsconfig 只认小程序类型），
// 故源扫放在 cloud 测试（有 node types）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { COUPON } from '@ldrw/shared'

const here = dirname(fileURLToPath(import.meta.url))
const mp = (...p: string[]) => resolve(here, '../../mp', ...p)

describe('主线顾客页不展示优惠券（2026-09-02·开发版/发布版禁展示）', () => {
  it('大白话：结算页和订单详情页金额明细没有「优惠券」这一行——历史单也不写这几个字', () => {
    expect(COUPON).toBe(0)
    for (const rel of ['pages/checkout/checkout.wxml', 'pages/order/order.wxml']) {
      const wxml = readFileSync(mp(rel), 'utf8')
      expect(wxml, rel).not.toContain('优惠券')
      expect(wxml, rel).not.toContain('couponLabel')
    }
  })
})
