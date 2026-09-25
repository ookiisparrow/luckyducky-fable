// @vitest-environment happy-dom
// ScmBom.vue 挂载测试：配方/差异位/组装记录加载与分路报错；模板没载入不许保存（防覆盖整份配方）；
// 预演连点或改了产品后，旧预演回包不回灌。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getBomSetup: vi.fn(),
  saveBomTemplate: vi.fn(),
  saveBomProfile: vi.fn(),
  previewAssembly: vi.fn(),
  runAssembly: vi.fn(),
  listAssemblies: vi.fn(),
  listMaterials: vi.fn(),
  listDrafts: vi.fn(),
}))
vi.mock('../src/api/scm', () => api)
vi.mock('../src/api/products', () => ({ listDrafts: api.listDrafts }))

import ScmBom from '../src/pages/ScmBom.vue'

// 形状照云端 getBomSetup / listAssemblies / previewAssembly
const SETUP = {
  ok: true,
  template: { commonLines: [{ materialId: 'tool:hook', qtyPerSet: 1 }], yarnSlots: [{ tier: 'L', form: 'knotted', qtyPerSet: 2 }] },
  profiles: [
    { _id: 'p1', yarnColors: { L: 'pink', M: 'blue', S: 'white' }, packagingMaterialId: 'pkg:p1', cardMaterialId: 'card:p1' },
    { _id: 'p2', yarnColors: { L: 'red' } },
  ],
}
const lines = (materialId: string) => ({ ok: true, lines: [{ materialId, name: materialId, uom: 'count', need: 2, stock: 1, short: 1, missing: false }] })
const pending = () => {
  let release: (v: unknown) => void = () => {}
  const p = new Promise((r) => (release = r))
  return { p, release: (v: unknown) => release(v) }
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.getBomSetup.mockResolvedValue(SETUP)
  api.listMaterials.mockResolvedValue({ ok: true, list: [{ _id: 'tool:hook', category: 'tool' }] })
  api.listAssemblies.mockResolvedValue({ ok: true, list: [{ _id: 'asm-1', productId: 'p1', spec: '红', sets: 3, operator: 'admin', at: 1, consumedLines: [] }], nextCursor: null, hasMore: false })
  api.listDrafts.mockResolvedValue({ ok: true, list: [{ id: 'p1', name: '小熊' }] })
  api.saveBomTemplate.mockResolvedValue({ ok: true })
})
const mountPage = async () => {
  const w = mount(ScmBom, { global: { stubs: { ScmFlowTabs: true } } })
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const status = (w: W) => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')
const btn = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)!

describe('ScmBom.vue 加载', () => {
  it('大白话：差异位、组装记录都渲染，缺专属件的差异位标红', async () => {
    const w = await mountPage()
    expect(status(w)).toBe('')
    expect(w.findAll('.prof-line').map((l) => l.text())).toEqual(['小熊：L=pink M=blue S=white', 'p2：L=red M=— S=—缺专属件'])
    expect(w.find('.ld-tbody .ld-tr').text()).toContain('asm-1')
    expect(w.find('.ld-tbody .ld-tr').text()).toContain('小熊（红）')
  })

  it('大白话：组装记录挂了——点名报错，记录区写加载失败，不装成「还没有组装记录」', async () => {
    api.listAssemblies.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountPage()
    expect(status(w)).toBe('组装记录加载失败：X1')
    expect(w.text()).toContain('组装记录加载失败，请刷新重试')
    expect(w.text()).not.toContain('还没有组装记录')
  })
})

describe('ScmBom.vue 保存模板', () => {
  it('大白话：保存成功带着当前模板、报已保存', async () => {
    const w = await mountPage()
    await btn(w, '保存模板').trigger('click')
    await flushPromises()
    expect(api.saveBomTemplate).toHaveBeenCalledWith(SETUP.template)
    expect(status(w)).toBe('模板已保存（历史组装单的快照不受影响）')
  })

  it('大白话：保存失败显原因', async () => {
    api.saveBomTemplate.mockResolvedValue({ ok: false, status: 400, error: 'BAD_DELTA' })
    const w = await mountPage()
    await btn(w, '保存模板').trigger('click')
    await flushPromises()
    expect(status(w)).toBe('调整量要是非零整数')
  })

  it('大白话：模板没载入成功——点保存不发请求（空模板会覆盖整份配方），提示刷新', async () => {
    api.getBomSetup.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountPage()
    expect(status(w)).toBe('配方模板加载失败：X1')
    await btn(w, '保存模板').trigger('click')
    await flushPromises()
    expect(api.saveBomTemplate).not.toHaveBeenCalled()
    expect(status(w)).toBe('模板未成功载入，暂不能保存（避免覆盖已有配方模板·请刷新重试）')
  })
})

describe('ScmBom.vue 预演乱序（G5）', () => {
  const pickProduct = async (w: W, id: string) => {
    await w.find('.run-form select').setValue(id)
    await flushPromises()
  }
  const previewRows = (w: W) => w.findAll('.pv-row').map((r) => r.find('span').text())

  it('大白话：连点两次预演，先发的后回包不覆盖后发的', async () => {
    const w = await mountPage()
    await pickProduct(w, 'p1')
    const old = pending()
    api.previewAssembly.mockReturnValueOnce(old.p).mockResolvedValueOnce(lines('tool:scissors'))
    await btn(w, '预演（只看不扣）').trigger('click')
    await btn(w, '预演（只看不扣）').trigger('click')
    await flushPromises()
    old.release(lines('tool:hook'))
    await flushPromises()
    expect(api.previewAssembly).toHaveBeenLastCalledWith('p1', 1)
    expect(previewRows(w)).toHaveLength(1)
    expect(previewRows(w)[0]).not.toContain('hook')
  })

  it('大白话：预演在途时改了产品——旧回包不把缺料表灌回来', async () => {
    const w = await mountPage()
    await pickProduct(w, 'p1')
    const old = pending()
    api.previewAssembly.mockReturnValueOnce(old.p)
    await btn(w, '预演（只看不扣）').trigger('click')
    await pickProduct(w, 'p2')
    old.release(lines('tool:hook'))
    await flushPromises()
    expect(w.find('.preview').exists()).toBe(false)
  })
})
