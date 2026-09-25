// @vitest-environment happy-dom
// ScmPurchase.vue 挂载测试：列表加载与分路报错（失败不装空态）、建草稿成败、
// 保存回包晚到时已切表单不打到新表单、翻页在途时切了筛选不把旧页混进来。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  listPurchases: vi.fn(),
  savePurchase: vi.fn(),
  markOrdered: vi.fn(),
  receivePurchase: vi.fn(),
  cancelPurchase: vi.fn(),
  listMaterials: vi.fn(),
  listSuppliers: vi.fn(),
}))
vi.mock('../src/api/scm', () => api)

import ScmPurchase from '../src/pages/ScmPurchase.vue'

// 形状照云端 listPurchases / savePurchase（金额是分）
const draft = { _id: 'po1', supplierId: 's1', status: 'draft', lines: [{ materialId: 'tool:hook', qty: 2, unitPriceFen: 150 }], totalFen: 300, createdAt: 1 }
const ordered = { _id: 'po2', supplierId: 's1', status: 'ordered', lines: [], totalFen: 1000, createdAt: 2 }
const pending = () => {
  let release: (v: unknown) => void = () => {}
  const p = new Promise((r) => (release = r))
  return { p, release: (v: unknown) => release(v) }
}
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listPurchases.mockResolvedValue({ ok: true, list: [draft, ordered], nextCursor: 'c1', hasMore: true })
  api.listMaterials.mockResolvedValue({ ok: true, list: [{ _id: 'tool:hook' }] })
  api.listSuppliers.mockResolvedValue({ ok: true, list: [{ _id: 's1', name: '甲厂', type: 'factory' }, { _id: 'w1', name: '织女', type: 'outworker' }] })
  api.savePurchase.mockResolvedValue({ ok: true, purchaseId: 'po9', totalFen: 300 })
})
const mountPage = async () => {
  const w = mount(ScmPurchase, { global: { stubs: { ScmFlowTabs: true } } })
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const status = (w: W) => (w.find('p.msg').exists() ? w.find('p.msg').text() : '')
const btn = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)!
const rowIds = (w: W) => w.findAll('.ld-tbody .oid').map((r) => r.text())

describe('ScmPurchase.vue 加载', () => {
  it('大白话：列出采购单、厂家名、总价（分转元）', async () => {
    const w = await mountPage()
    expect(status(w)).toBe('')
    expect(rowIds(w)).toEqual(['po1', 'po2'])
    const first = w.find('.ld-tbody .ld-tr').text()
    expect(first).toContain('甲厂')
    expect(first).toContain('¥3.00')
  })

  it('大白话：采购单挂了——点名报错，不装成「还没有采购单」', async () => {
    api.listPurchases.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountPage()
    expect(status(w)).toBe('采购单加载失败：操作没成功（X1）')
    expect(w.text()).not.toContain('还没有采购单')
  })
})

describe('ScmPurchase.vue 建草稿', () => {
  const fillNew = async (w: W, price: string) => {
    await btn(w, '新建采购单').trigger('click')
    await w.find('select.sup-sel').setValue('s1')
    await w.find('.linerow select').setValue('tool:hook')
    await w.find('.linerow input[type="number"]').setValue(2)
    await w.find('.linerow input[placeholder="单价（元）"]').setValue(price)
    await btn(w, '保存草稿').trigger('click')
    await flushPromises()
  }

  it('大白话：单价按元填、按分发给后端；成功关表单报服务端核算总价', async () => {
    const w = await mountPage()
    await fillNew(w, '1.5')
    expect(api.savePurchase).toHaveBeenCalledWith('s1', [{ materialId: 'tool:hook', qty: 2, unitPriceFen: 150 }], undefined)
    expect(status(w)).toBe('草稿已建（总价 ¥3.00·服务端核算）')
    expect(w.text()).not.toContain('新建采购草稿')
  })

  it('大白话：保存失败显原因、表单留着', async () => {
    api.savePurchase.mockResolvedValue({ ok: false, status: 400, error: 'NO_SUPPLIER' })
    const w = await mountPage()
    await fillNew(w, '1.5')
    expect(status(w)).toBe('找不到这个供应商')
    expect(w.text()).toContain('新建采购草稿')
  })

  it('大白话：单价不合法不发请求', async () => {
    const w = await mountPage()
    await fillNew(w, '1.555')
    expect(api.savePurchase).not.toHaveBeenCalled()
    expect(status(w)).toBe('单价不合法（元·最多两位小数）')
  })

  it('大白话：保存在途时已点「新建采购单」——回包不关新表单、不写反馈，列表照刷', async () => {
    const save = pending()
    api.savePurchase.mockReturnValue(save.p)
    const w = await mountPage()
    await btn(w, '编辑').trigger('click')
    await btn(w, '保存草稿').trigger('click')
    expect(api.savePurchase).toHaveBeenCalledWith('s1', [{ materialId: 'tool:hook', qty: 2, unitPriceFen: 150 }], 'po1')
    await btn(w, '新建采购单').trigger('click')
    const listCalls = api.listPurchases.mock.calls.length
    save.release({ ok: true, purchaseId: 'po1', totalFen: 300 })
    await flushPromises()
    expect(w.text()).toContain('新建采购草稿')
    expect(status(w)).toBe('')
    expect(api.listPurchases.mock.calls.length).toBe(listCalls + 1)
  })
})

describe('ScmPurchase.vue 列表乱序', () => {
  it('大白话：加载更多在途时切了筛选——旧筛选的下一页不混进新列表', async () => {
    const w = await mountPage()
    const page2 = pending()
    api.listPurchases.mockReturnValueOnce(page2.p).mockResolvedValueOnce({ ok: true, list: [draft], hasMore: false })
    await btn(w, '加载更多').trigger('click')
    await btn(w, '草稿').trigger('click')
    await flushPromises()
    page2.release({ ok: true, list: [{ ...ordered, _id: 'po3' }], nextCursor: 'c2', hasMore: true })
    await flushPromises()
    expect(api.listPurchases).toHaveBeenLastCalledWith('draft')
    expect(rowIds(w)).toEqual(['po1'])
  })

  it('大白话：快切筛选，先发的后回包不覆盖当前筛选', async () => {
    const w = await mountPage()
    const first = pending()
    api.listPurchases.mockReturnValueOnce(first.p).mockResolvedValueOnce({ ok: true, list: [ordered], hasMore: false })
    await btn(w, '草稿').trigger('click')
    await btn(w, '已下单').trigger('click')
    await flushPromises()
    first.release({ ok: true, list: [draft], hasMore: false })
    await flushPromises()
    expect(rowIds(w)).toEqual(['po2'])
  })
})
