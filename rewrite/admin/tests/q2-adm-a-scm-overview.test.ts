// @vitest-environment happy-dom
// ScmOverview.vue 挂载测试：总览渲染、读失败说人话且不装「库存健康」、缺料行去开单带对料号与缺口。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { getScmOverview, push } = vi.hoisted(() => ({ getScmOverview: vi.fn(), push: vi.fn() }))
vi.mock('../src/api/scm', () => ({ getScmOverview }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import ScmOverview from '../src/pages/ScmOverview.vue'
import { consumeOutworkHandoff, consumePurchaseHandoff } from '../src/lib/scmHandoff'

// 形状照云端 getScmOverview（cloud/tests/app-scm.test.ts 总览段）
const overview = {
  ok: true,
  lowStock: [
    { materialId: 'yarn:pink:L:knotted', name: '粉色带结', uomLabel: '件', qty: 2, threshold: 10, gap: 8, suggest: 'outwork' },
    { materialId: 'yarn:blue:M:raw', name: '蓝色中团', uomLabel: '件', qty: 5, threshold: 8, gap: 3, suggest: 'purchase' },
  ],
  payables: [{ supplierId: 'w1', name: '织女一号', payableFen: 1200, orderCount: 2 }],
  payableTotalFen: 1200,
  inTransit: { purchaseCount: 2, outworkCount: 1 },
  recentLedger: [{ _id: 'l1', itemKey: 'stuffing', delta: -3, docType: 'ship', docId: 'o9', at: 1_700_000_000_000 }],
}

beforeEach(() => {
  getScmOverview.mockReset().mockResolvedValue(overview)
  push.mockReset()
  consumeOutworkHandoff()
  consumePurchaseHandoff()
})
const mountPage = async () => {
  const w = mount(ScmOverview)
  await flushPromises()
  return w
}
const btn = (w: Awaited<ReturnType<typeof mountPage>>, text: string) => w.findAll('button').find((b) => b.text().includes(text))!

describe('ScmOverview.vue 加载', () => {
  it('大白话：读成功——KPI、缺料行、应付（分转元）、发货流水都画出来，没有错误提示', async () => {
    const w = await mountPage()
    const text = w.text()
    expect(w.find('.ld-status').exists()).toBe(false)
    expect(w.findAll('.ld-tbody .ld-tr').map((r) => r.text())).toEqual([expect.stringContaining('粉色带结'), expect.stringContaining('蓝色中团')])
    expect(w.find('.pay-row').text()).toContain('织女一号')
    expect(w.find('.pay-row').text()).toContain('¥12.00')
    expect(w.find('.ledger-row').text()).toContain('订单 o9')
    expect(w.find('.ledger-row').text()).toContain('-3')
    expect(text).not.toContain('库存健康')
  })

  it('大白话：读失败——说人话原因、不画 KPI 也不显「库存健康」；点重试再读一次', async () => {
    getScmOverview.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:Failed to fetch' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toContain('总览加载失败：网络不通')
    expect(w.text()).not.toContain('NETWORK')
    expect(w.text()).not.toContain('库存健康')
    expect(w.find('.ld-kpi-grid').exists()).toBe(false)

    getScmOverview.mockResolvedValue(overview)
    await btn(w, '重试').trigger('click')
    await flushPromises()
    expect(getScmOverview).toHaveBeenCalledTimes(2)
    expect(w.find('.ld-status').exists()).toBe(false)
    expect(w.find('.ld-kpi-grid').exists()).toBe(true)
  })

  it('大白话：业务码读失败也不甩裸码，给中文兜底', async () => {
    getScmOverview.mockResolvedValue({ ok: false, status: 500, error: 'DB_READ_FAIL' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toMatch(/^总览加载失败：[一-鿿]/)
  })

  it('大白话：真没缺料才显「库存健康」', async () => {
    getScmOverview.mockResolvedValue({ ...overview, lowStock: [] })
    const w = await mountPage()
    expect(w.text()).toContain('库存健康')
  })
})

describe('ScmOverview.vue 缺料行去开单', () => {
  it('大白话：带结料缺口去外协，预填同色大团原团、数量＝缺口', async () => {
    const w = await mountPage()
    await btn(w, '去外协').trigger('click')
    expect(push).toHaveBeenCalledWith('/scm-outwork')
    expect(consumeOutworkHandoff()).toEqual({ lines: [{ materialId: 'yarn:pink:L:raw', qty: 8 }] })
  })

  it('大白话：其余缺口去采购，预填原料号和缺口，供应商留空', async () => {
    const w = await mountPage()
    await btn(w, '去采购').trigger('click')
    expect(push).toHaveBeenCalledWith('/scm-purchase')
    expect(consumePurchaseHandoff()).toEqual({ supplierId: '', lines: [{ materialId: 'yarn:blue:M:raw', qty: 3 }] })
  })
})
