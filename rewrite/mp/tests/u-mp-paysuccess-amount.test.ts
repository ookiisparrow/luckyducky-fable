// 支付成功页 ?amount=分 → 展示金额（元两位小数）；缺/空/非数/负数一律隐去金额行，绝不写死。
// Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }))
vi.mock('../api/learning', () => ({ trackEvent: trackMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/homeIntent', () => ({ goHomeTab: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function load(query: Record<string, string | undefined>) {
  vi.resetModules()
  await import('../pages/paysuccess/paysuccess')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad(query)
  return { amountYuan: page.data.amountYuan, hasAmount: page.data.hasAmount }
}

beforeEach(() => {
  trackMock.mockReset()
})

describe('支付成功页金额解析', () => {
  it('大白话：合法的分（含 0 元单）→ 元两位小数、显示金额行', async () => {
    expect(await load({ id: 'o1', amount: '12800' })).toEqual({ amountYuan: '128.00', hasAmount: true })
    expect(await load({ id: 'o1', amount: '1' })).toEqual({ amountYuan: '0.01', hasAmount: true })
    expect(await load({ id: 'o1', amount: '0' })).toEqual({ amountYuan: '0.00', hasAmount: true })
    expect(trackMock).toHaveBeenLastCalledWith('pay_success_view', 'paysuccess', 'o1', { amountYuan: '0.00', hasAmount: true })
  })

  it('大白话：缺 amount / 空串 / 非数 / 负数 → 隐去金额行', async () => {
    for (const amount of [undefined, '', 'abc', '-1', 'Infinity']) {
      expect(await load({ id: 'o1', amount })).toEqual({ amountYuan: '', hasAmount: false })
    }
    expect(trackMock).toHaveBeenLastCalledWith('pay_success_view', 'paysuccess', 'o1', { amountYuan: '', hasAmount: false })
  })

  it('大白话：全空格字符串按 Number 规则是 0 → 显示 0.00（与原判定一致）', async () => {
    expect(await load({ id: 'o1', amount: ' ' })).toEqual({ amountYuan: '0.00', hasAmount: true })
  })
})
