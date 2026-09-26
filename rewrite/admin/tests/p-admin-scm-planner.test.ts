// @vitest-environment happy-dom
// ScmPlanner.vue 挂载测试：产销三列并表、分路加载报错、算缺口成败，连点「算缺口」旧回包不覆盖新结果。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ getRestockPlan: vi.fn(), getFgSummary: vi.fn(), listInventory: vi.fn(), listDrafts: vi.fn(), push: vi.fn() }))
vi.mock('../src/api/scm', () => ({ getRestockPlan: api.getRestockPlan, getFgSummary: api.getFgSummary }))
vi.mock('../src/api/system', () => ({ listInventory: api.listInventory }))
vi.mock('../src/api/products', () => ({ listDrafts: api.listDrafts }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: api.push }) }))

import ScmPlanner from '../src/pages/ScmPlanner.vue'

// 形状照云端 getFgSummary / getRestockPlan / listInventory
const plan = (color: string) => ({
  ok: true,
  outworkGaps: [{ color, knottedNeed: 10, knottedStock: 4, gap: 6, rawToIssue: 6 }],
  purchaseGroups: [{ supplierId: 's1', supplierName: '甲厂', lines: [{ materialId: 'tool:hook', name: '钩针', uom: 'count', need: 10, stock: 2, gap: 8, missing: false }] }],
  missingMaterials: [],
})
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.getFgSummary.mockResolvedValue({ ok: true, packed: [{ productId: 'p1', spec: '红', qty: 12 }], shipped: [{ productId: 'p1', spec: '红', qty: 5 }], truncated: false })
  api.listInventory.mockResolvedValue({ ok: true, list: [{ _id: 'fg:p1__红', productId: 'p1', spec: '红', stock: 7 }] })
  api.listDrafts.mockResolvedValue({ ok: true, list: [{ id: 'p1', name: '小熊' }] })
  api.getRestockPlan.mockResolvedValue(plan('pink'))
})
const mountPage = async () => {
  const w = mount(ScmPlanner, { global: { stubs: { ScmFlowTabs: true } } })
  await flushPromises()
  return w
}
const status = (w: Awaited<ReturnType<typeof mountPage>>) => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')
const calc = async (w: Awaited<ReturnType<typeof mountPage>>) => {
  await w.findAll('button').find((b) => b.text() === '算缺口')!.trigger('click')
  await flushPromises()
}

describe('ScmPlanner.vue 产销加载', () => {
  it('大白话：打包/发货/现存按产品规格并成一行，名字用产品目录', async () => {
    const w = await mountPage()
    expect(status(w)).toBe('')
    expect(w.find('.ld-tbody .ld-tr').text()).toBe('小熊（红）12 套5 件7')
  })

  it('大白话：产销统计挂了——点名报错，不装成「还没有产销记录」', async () => {
    api.getFgSummary.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountPage()
    expect(status(w)).toBe('产销统计加载失败：操作没成功（X1）')
    // 库存那路仍有行：若失败被兜成空产销，会以 0 套 0 件 7 的假行渲染整张卡——所以断言整卡不出
    expect(w.findAll('.card-title').map((t) => t.text())).toEqual(['备货计算器'])
    expect(w.find('.ld-tbody').exists()).toBe(false)
    expect(w.text()).not.toContain('还没有产销记录')
  })

  it('大白话：库存列表到了扫描上限（truncated）——现存那列可能缺行，卡头要写列表可能不全', async () => {
    api.listInventory.mockResolvedValue({ ok: true, list: [{ _id: 'fg:p1__红', productId: 'p1', spec: '红', stock: 7 }], truncated: true })
    const w = await mountPage()
    expect(w.findAll('.card-sub')[1].text()).toContain('列表可能不全')
  })

  it('大白话：库存和产品目录挂了——各自点名，不静默吞成空表', async () => {
    api.listInventory.mockResolvedValue({ ok: false, status: 500, error: 'X2' })
    api.listDrafts.mockResolvedValue({ ok: false, status: 500, error: 'X3' })
    const w = await mountPage()
    expect(status(w)).toBe('库存加载失败：操作没成功（X2）；产品目录加载失败：操作没成功（X3）')
  })
})

describe('ScmPlanner.vue 算缺口', () => {
  it('大白话：填产品点算缺口，按填的目标请求并列出外协/采购缺口', async () => {
    const w = await mountPage()
    await w.find('input[placeholder="产品（选或输 id）"]').setValue(' p1 ')
    await calc(w)
    expect(api.getRestockPlan).toHaveBeenCalledWith([{ productId: 'p1', sets: 10 }])
    expect(w.text()).toContain('缺 6（应发原团 6）')
    expect(w.text()).toContain('甲厂')
    expect(w.text()).toContain('缺 8')
  })

  it('大白话：算缺口失败显原因、不留旧结果', async () => {
    const w = await mountPage()
    await w.find('input[placeholder="产品（选或输 id）"]').setValue('p1')
    await calc(w)
    api.getRestockPlan.mockResolvedValue({ ok: false, status: 400, error: 'NO_SUPPLIER' })
    await calc(w)
    expect(status(w)).toBe('找不到这个供应商')
    expect(w.find('.gap-block').exists()).toBe(false)
  })

  it('大白话：没填产品不发请求', async () => {
    const w = await mountPage()
    await calc(w)
    expect(api.getRestockPlan).not.toHaveBeenCalled()
    expect(status(w)).toBe('先填至少一个产品')
  })

  it('大白话：连点两次，先发的后回包不覆盖后发的结果', async () => {
    const w = await mountPage()
    await w.find('input[placeholder="产品（选或输 id）"]').setValue('p1')
    let releaseOld: (v: unknown) => void = () => {}
    api.getRestockPlan.mockReturnValueOnce(new Promise((r) => (releaseOld = r))).mockResolvedValueOnce(plan('blue'))
    await calc(w)
    await calc(w)
    releaseOld(plan('pink'))
    await flushPromises()
    expect(w.find('.gap-line .gap-name').text()).toBe('blue')
  })
})
