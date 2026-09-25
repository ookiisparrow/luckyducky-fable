// @vitest-environment happy-dom
// ScmOutwork.vue：收货按发料色预填同色带结团、收超发标红；分路加载报错；加载更多去重；发料两步确认。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  listOutworks: vi.fn(),
  saveOutwork: vi.fn(),
  issueOutwork: vi.fn(),
  receiveOutwork: vi.fn(),
  settleOutwork: vi.fn(),
  cancelOutwork: vi.fn(),
  listMaterials: vi.fn(),
  listSuppliers: vi.fn(),
}))
vi.mock('../src/api/scm', () => api)

import ScmOutwork from '../src/pages/ScmOutwork.vue'

const issued = {
  _id: 'ow1',
  status: 'issued',
  issueLines: [
    { materialId: 'yarn:pink:L:raw', qty: 3 },
    { materialId: 'yarn:blue:L:raw', qty: 2 },
    { materialId: 'yarn:pink:L:raw', qty: 1 },
    { materialId: 'tool:hook', qty: 5 },
  ],
}
const draft = { _id: 'ow2', status: 'draft', issueLines: [] }
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listOutworks.mockResolvedValue({ ok: true, list: [issued, draft], nextCursor: 'c1', hasMore: true })
  api.listMaterials.mockResolvedValue({ ok: true, list: [{ _id: 'yarn:pink:L:knotted' }, { _id: 'yarn:blue:L:knotted' }] })
  api.listSuppliers.mockResolvedValue({ ok: true, list: [] })
  api.issueOutwork.mockResolvedValue({ ok: true })
})
const mountPage = async () => {
  const w = mount(ScmOutwork, { global: { stubs: { ScmFlowTabs: true } } })
  await flushPromises()
  return w
}
const btn = (w: Awaited<ReturnType<typeof mountPage>>, text: string) => w.findAll('button').find((b) => b.text() === text)!

describe('ScmOutwork.vue 收货预填', () => {
  it('大白话：发的原团逐行换成同色带结团、数量照发；非毛线行不预填；同色上限按发量合计；收超发标红', async () => {
    const w = await mountPage()
    await btn(w, '收货').trigger('click')
    const rows = w.findAll('.recv-row')
    expect(rows.map((r) => (r.find('select').element as HTMLSelectElement).value)).toEqual(['yarn:pink:L:knotted', 'yarn:blue:L:knotted', 'yarn:pink:L:knotted'])
    expect(rows.map((r) => (r.find('input').element as HTMLInputElement).value)).toEqual(['3', '2', '1'])
    expect(rows[0].find('.cap').text()).toBe('上限 4')
    expect(rows[1].find('.cap').text()).toBe('上限 2')
    await rows[1].find('input').setValue(3)
    expect(w.findAll('.recv-row')[1].classes()).toContain('over')
  })
})

describe('ScmOutwork.vue 列表', () => {
  it('大白话：外协单与织女名单都挂，两条原因按顺序连起来', async () => {
    api.listOutworks.mockResolvedValue({ ok: false, error: 'A' })
    api.listSuppliers.mockResolvedValue({ ok: false, error: 'C' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toBe('外协单加载失败：A；织女名单加载失败：C')
  })

  it('大白话：加载更多只追加没见过的单', async () => {
    const w = await mountPage()
    api.listOutworks.mockResolvedValue({ ok: true, list: [draft, { _id: 'ow3', status: 'settled' }], hasMore: false })
    await btn(w, '加载更多').trigger('click')
    await flushPromises()
    expect(w.findAll('.ld-tbody .ld-tr').map((r) => r.find('.mono').text())).toEqual(['ow1', 'ow2', 'ow3'])
  })

  it('大白话：发料第一次只武装，第二次才真发', async () => {
    const w = await mountPage()
    await btn(w, '发料').trigger('click')
    expect(api.issueOutwork).not.toHaveBeenCalled()
    await btn(w, '确认发料出库？').trigger('click')
    await flushPromises()
    expect(api.issueOutwork).toHaveBeenCalledWith('ow2')
  })
})
