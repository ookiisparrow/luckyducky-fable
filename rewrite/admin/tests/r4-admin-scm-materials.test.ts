// @vitest-environment happy-dom
// ScmMaterials.vue 物料建档：连点只发一次（并发首建的输家会回 DUPLICATE、还会盖掉赢家的「已建档」）；
// 真撞上 DUPLICATE（别的页签/同事先建好）时说物料的话，不能说成组装的「这单组装已经执行过了」。
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
import { scmErrorText } from '../src/lib/mapScm'

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listMaterials.mockResolvedValue({ ok: true, list: [] })
  api.listSuppliers.mockResolvedValue({ ok: true, list: [] })
  api.listLedger.mockResolvedValue({ ok: true, list: [] })
})
const mountPage = async () => {
  const w = mount(ScmMaterials, { global: { stubs: { ScmFlowTabs: true } } })
  await flushPromises()
  return w
}
const saveBtn = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll('button').find((b) => /^(建档 \/ 更新|保存中)/.test(b.text()))!

describe('ScmMaterials.vue 建档在途锁', () => {
  it('大白话：连点两下「建档 / 更新」，只发一次 saveMaterial，按钮在途时锁住', async () => {
    let release: (v: unknown) => void = () => {}
    api.saveMaterial.mockReturnValueOnce(new Promise((r) => (release = r)))
    const w = await mountPage()
    await saveBtn(w).trigger('click')
    await saveBtn(w).trigger('click')
    expect(api.saveMaterial).toHaveBeenCalledTimes(1)
    expect(saveBtn(w).attributes('disabled')).toBeDefined()
    release({ ok: true, materialId: 'yarn:pink:L:raw' })
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe('已建档：yarn:pink:L:raw')
    expect(saveBtn(w).attributes('disabled')).toBeUndefined()
  })

  it('大白话：别处先建好了同一料号（回 DUPLICATE），说物料的话、不提组装', async () => {
    api.saveMaterial.mockResolvedValue({ ok: false, status: 409, error: 'DUPLICATE' })
    const w = await mountPage()
    await saveBtn(w).trigger('click')
    await flushPromises()
    const t = w.find('.ld-status').text()
    expect(t).toBe(scmErrorText('DUPLICATE', 'material'))
    expect(t).toContain('料号')
    expect(t).not.toContain('组装')
  })

  it('大白话：组装页的 DUPLICATE 文案不受影响', () => {
    expect(scmErrorText('DUPLICATE')).toBe('这单组装已经执行过了（不会双扣）')
  })
})
