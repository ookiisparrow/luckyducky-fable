import { describe, it, expect } from 'vitest'
import { MONEY_CHAIN, detectDrift } from '../../scripts/lib/deploy-drift.mjs'

// 守卫 preflight「钱链改了未部署→红」的核心逻辑（根因#8 已提交≠已部署）。
// 2026-06-16 实测漂移：钱链 [LD_ALERT] 等改了 4 天没部署、preflight 只验结构没验部署时效漏过。
describe('deploy-drift detectDrift：钱链改了未部署的检测', () => {
  it('hash 全等 → 无漂移（部署态≡代码态）', () => {
    const cur = { pay: 'aaa', createOrder: 'bbb' }
    expect(detectDrift(cur, { pay: 'aaa', createOrder: 'bbb' }, ['pay', 'createOrder'])).toEqual([])
  })
  it('hash 不符 → 漂移（代码领先部署·核心场景）', () => {
    const d = detectDrift({ pay: 'newhash' }, { pay: 'oldhash' }, ['pay'])
    expect(d).toHaveLength(1)
    expect(d[0]).toContain('pay')
    expect(d[0]).toContain('oldhash')
  })
  it('manifest 缺该函数 → 漂移（从未部署）', () => {
    expect(detectDrift({ pay: 'x' }, {}, ['pay'])).toHaveLength(1)
    expect(detectDrift({ pay: 'x' }, {}, ['pay'])[0]).toContain('未部署')
  })
  it('产物缺 → 漂移（构建漏产）', () => {
    expect(detectDrift({}, { pay: 'x' }, ['pay'])).toEqual(['pay(产物缺)'])
  })
  it('只查传入的 fns 子集（不误判其它函数）', () => {
    expect(detectDrift({ pay: 'a', other: 'X' }, { pay: 'a', other: 'Y' }, ['pay'])).toEqual([])
  })
})

describe('deploy-drift MONEY_CHAIN：钱链 6 函数（≡ guard-deploy SENSITIVE_FNS 钱链段）', () => {
  it('含支付/退款/下单/关单全链', () => {
    for (const fn of ['createOrder', 'pay', 'payCallback', 'applyRefund', 'refundCallback', 'closeExpiredOrders'])
      expect(MONEY_CHAIN).toContain(fn)
    expect(MONEY_CHAIN).toHaveLength(6)
  })
})
