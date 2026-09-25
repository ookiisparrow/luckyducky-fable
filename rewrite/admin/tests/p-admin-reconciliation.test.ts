// @vitest-environment happy-dom
// Reconciliation.vue 挂载测试：两路加载各自报错、拉账单后刷新失败不能被「成功」文案盖掉。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ getReconciliation: vi.fn(), getBillMatch: vi.fn(), downloadBill: vi.fn() }))
vi.mock('../src/api/system', () => api)

import Reconciliation from '../src/pages/Reconciliation.vue'
import CONTRACT from '../../../tests/contracts/admin-money.json'

// 回包取 tests/contracts/admin-money.json 的 sample（云端测试对着真 adminApi 锁住形状与单位：金额是元）
const sample = (name: string) => structuredClone((CONTRACT.cases as unknown as Record<string, { sample: any }>)[name].sample)
const RECON = sample('getReconciliation')
const MATCH = sample('getBillMatch')
const FAIL = { ok: false, status: 500, error: 'X1' }

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.getReconciliation.mockResolvedValue(RECON)
  api.getBillMatch.mockResolvedValue(MATCH)
  api.downloadBill.mockResolvedValue({ ok: true })
})
const mountPage = async () => {
  const w = mount(Reconciliation)
  await flushPromises()
  return w
}
const status = (w: Awaited<ReturnType<typeof mountPage>>) => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')
const btn = (w: Awaited<ReturnType<typeof mountPage>>, text: string) => w.findAll('button').find((b) => b.text() === text)!

describe('Reconciliation.vue 加载', () => {
  it('大白话：两路都成功——渲染全账累计（元）、内部异常、逐日表、三类差异，没有错误横幅', async () => {
    const w = await mountPage()
    expect(status(w)).toBe('')
    expect(w.text()).toContain('全账累计 应收 ¥694.00 − 退款 ¥198.00 = 净额 ¥496.00')
    expect(w.text()).toContain('内部有 1 笔异常待处理')
    expect(w.text()).toContain('2026-07-01')
    expect(w.text()).toContain('wx-ghost')
    expect(w.text()).toContain('¥5.50')
    expect(w.text()).toContain('¥190.00')
  })

  it('大白话：内部对账挂、外部勾对好——点名内部失败，不被另一路成功清空；不显空态', async () => {
    api.getReconciliation.mockResolvedValue(FAIL)
    const w = await mountPage()
    expect(status(w)).toBe('内部对账加载失败：操作失败（X1）')
    expect(w.text()).not.toContain('内部账已对平')
  })

  it('大白话：外部勾对挂、内部好——点名外部失败', async () => {
    api.getBillMatch.mockResolvedValue(FAIL)
    const w = await mountPage()
    expect(status(w)).toBe('外部账单勾对加载失败：操作失败（X1）')
    expect(w.text()).not.toContain('逐笔已勾对')
  })

  it('大白话：两路都挂——两条原因按顺序用「；」连', async () => {
    api.getReconciliation.mockResolvedValue(FAIL)
    api.getBillMatch.mockResolvedValue({ ok: false, status: 500, error: 'X2' })
    const w = await mountPage()
    expect(status(w)).toBe('内部对账加载失败：操作失败（X1）；外部账单勾对加载失败：操作失败（X2）')
  })

  it('大白话：先发的区间查询后回包，不覆盖后发区间的结果', async () => {
    const w = await mountPage()
    let releaseOld: (v: unknown) => void = () => {}
    api.getReconciliation.mockReturnValueOnce(new Promise((r) => (releaseOld = r))).mockResolvedValueOnce({ ...RECON, cumulative: { income: 5, refund: 0, net: 5 } })
    await w.findAll('input')[0].setValue('2026-08-01')
    await btn(w, '查询').trigger('click')
    await btn(w, '查询').trigger('click')
    await flushPromises()
    releaseOld({ ...RECON, cumulative: { income: 777, refund: 0, net: 777 } })
    await flushPromises()
    expect(w.text()).toContain('全账累计 应收 ¥5.00')
    expect(w.text()).not.toContain('¥777.00')
  })
})

describe('Reconciliation.vue 拉单日账单', () => {
  const pull = async (w: Awaited<ReturnType<typeof mountPage>>) => {
    await w.find('input[placeholder="拉某日账单 YYYY-MM-DD"]').setValue('2026-09-01')
    await btn(w, '拉单日').trigger('click')
    await flushPromises()
  }

  it('大白话：拉取和刷新都成功才显纯成功，拉的是填的那天', async () => {
    const w = await mountPage()
    await pull(w)
    expect(api.downloadBill).toHaveBeenCalledWith('2026-09-01')
    expect(status(w)).toBe('账单已拉取入库，勾对已刷新')
  })

  it('大白话：拉取失败显拉取失败原因', async () => {
    const w = await mountPage()
    api.downloadBill.mockResolvedValue({ ok: false, status: 500, error: 'X3' })
    await pull(w)
    expect(status(w)).toBe('拉取失败：操作失败（X3）')
  })

  it('大白话：拉取成功但随后的刷新失败——保留刷新的错误原文，不被「勾对已刷新」盖掉', async () => {
    const w = await mountPage()
    api.getReconciliation.mockResolvedValue(FAIL)
    await pull(w)
    expect(status(w)).toBe('账单已拉取入库，但对账刷新失败：内部对账加载失败：操作失败（X1）')
  })

  it('大白话：拉完后刷新还没回来时按钮仍锁着，连点不重复拉；刷新落地才解锁', async () => {
    const w = await mountPage()
    let releaseRefresh: (v: unknown) => void = () => {}
    api.getReconciliation.mockReturnValueOnce(new Promise((r) => (releaseRefresh = r)))
    await pull(w)
    expect(btn(w, '拉单日').attributes('disabled')).toBeDefined()
    expect(btn(w, '拉整个区间').attributes('disabled')).toBeDefined()
    await btn(w, '拉单日').trigger('click')
    await flushPromises()
    expect(api.downloadBill).toHaveBeenCalledTimes(1)
    releaseRefresh(RECON)
    await flushPromises()
    expect(btn(w, '拉单日').attributes('disabled')).toBeUndefined()
    expect(btn(w, '拉整个区间').attributes('disabled')).toBeUndefined()
    expect(status(w)).toBe('账单已拉取入库，勾对已刷新')
  })

  it('大白话：日期不合法不发请求', async () => {
    const w = await mountPage()
    await w.find('input[placeholder="拉某日账单 YYYY-MM-DD"]').setValue('9月1日')
    await btn(w, '拉单日').trigger('click')
    expect(api.downloadBill).not.toHaveBeenCalled()
    expect(status(w)).toBe('日期格式 YYYY-MM-DD')
  })
})

describe('Reconciliation.vue 拉整个区间', () => {
  const pullRange = async (w: Awaited<ReturnType<typeof mountPage>>) => {
    const [from, to] = w.findAll('input')
    await from.setValue('2026-09-01')
    await to.setValue('2026-09-03')
    await btn(w, '拉整个区间').trigger('click')
    await flushPromises()
  }

  it('大白话：逐日拉三天、数成功天数；刷新成功显纯成功', async () => {
    const w = await mountPage()
    api.downloadBill.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'X' }).mockResolvedValueOnce({ ok: true })
    await pullRange(w)
    expect(api.downloadBill.mock.calls.map((c) => c[0])).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(status(w)).toBe('区间账单已拉取 2/3 天，勾对已刷新')
  })

  it('大白话：逐日拉完后刷新还没回来时按钮仍锁着，连点不重复拉；刷新落地才解锁', async () => {
    const w = await mountPage()
    let releaseRefresh: (v: unknown) => void = () => {}
    api.getReconciliation.mockReturnValueOnce(new Promise((r) => (releaseRefresh = r)))
    await pullRange(w)
    expect(api.downloadBill).toHaveBeenCalledTimes(3)
    expect(btn(w, '拉单日').attributes('disabled')).toBeDefined()
    expect(btn(w, '拉整个区间').attributes('disabled')).toBeDefined()
    await btn(w, '拉整个区间').trigger('click')
    await flushPromises()
    expect(api.downloadBill).toHaveBeenCalledTimes(3)
    releaseRefresh(RECON)
    await flushPromises()
    expect(btn(w, '拉单日').attributes('disabled')).toBeUndefined()
    expect(btn(w, '拉整个区间').attributes('disabled')).toBeUndefined()
    expect(status(w)).toBe('区间账单已拉取 3/3 天，勾对已刷新')
  })

  it('大白话：刷新失败要把错误原文拼在后面，不能被纯成功文案盖掉', async () => {
    const w = await mountPage()
    api.getBillMatch.mockResolvedValue(FAIL)
    await pullRange(w)
    expect(status(w)).toBe('区间账单已拉取 3/3 天，但对账刷新失败：外部账单勾对加载失败：操作失败（X1）')
  })
})
