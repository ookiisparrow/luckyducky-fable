// @vitest-environment happy-dom
// ScmMaterials.vue：批量盘点只提交有差异的行；分路加载失败各报各的原因。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  listMaterials: vi.fn(),
  saveMaterial: vi.fn(),
  listSuppliers: vi.fn(),
  saveSupplier: vi.fn(),
  adjustStock: vi.fn(),
  listLedger: vi.fn(),
}))
vi.mock('../src/api/scm', () => api)

import ScmMaterials from '../src/pages/ScmMaterials.vue'

const mat = (id: string, stock: number) => ({ _id: id, category: 'yarn', uom: 'count', stock })
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listMaterials.mockResolvedValue({ ok: true, list: [mat('m1', 5), mat('m2', 7), mat('m3', 9)] })
  api.listSuppliers.mockResolvedValue({ ok: true, list: [] })
  api.listLedger.mockResolvedValue({ ok: true, list: [] })
  api.adjustStock.mockResolvedValue({ ok: true })
})
const mountPage = async () => {
  const w = mount(ScmMaterials, { global: { stubs: { ScmFlowTabs: true } } })
  await flushPromises()
  return w
}

describe('ScmMaterials.vue 批量盘点', () => {
  it('大白话：三行里一行有差异、一行持平、一行没填，只对有差异那行调一次 adjustStock', async () => {
    const w = await mountPage()
    await w.findAll('button').find((b) => b.text().includes('批量盘点'))!.trigger('click')
    await flushPromises()
    const inputs = w.findAll('input.stocktake-actual')
    await inputs[0].setValue(3)
    await inputs[1].setValue(7)
    await w.findAll('button').find((b) => b.text().startsWith('提交盘点'))!.trigger('click')
    await flushPromises()
    expect(api.adjustStock).toHaveBeenCalledTimes(1)
    expect(api.adjustStock.mock.calls[0].slice(0, 2)).toEqual(['m1', -2])
  })
})

describe('ScmMaterials.vue 分路加载报错', () => {
  it('大白话：物料和供应商都挂，两条原因按顺序用「；」连起来', async () => {
    api.listMaterials.mockResolvedValue({ ok: false, error: 'A' })
    api.listSuppliers.mockResolvedValue({ ok: false, error: 'B' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toBe('物料主档加载失败：A；供应商加载失败：B')
  })

  it('大白话：只有供应商挂，只报供应商', async () => {
    api.listSuppliers.mockResolvedValue({ ok: false, error: 'B' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toBe('供应商加载失败：B')
  })
})
