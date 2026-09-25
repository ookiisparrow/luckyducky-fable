// @vitest-environment happy-dom
// ScmOutwork.vue：收货按发料色预填同色带结团、收超发标红；分路加载报错；加载更多去重；发料两步确认；
// 回包晚到时已切到别的表单/列表已刷新——反馈与翻页结果不打到新目标上。
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
  it('大白话：外协单与织女名单都挂，两条原因按顺序连起来，不装成「还没有外协单」', async () => {
    api.listOutworks.mockResolvedValue({ ok: false, error: 'A' })
    api.listSuppliers.mockResolvedValue({ ok: false, error: 'C' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toBe('外协单加载失败：A；织女名单加载失败：C')
    expect(w.text()).not.toContain('还没有外协单')
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

const pending = () => {
  let release: (v: unknown) => void = () => {}
  const p = new Promise((r) => (release = r))
  return { p, release: (v: unknown) => release(v) }
}
const status = (w: Awaited<ReturnType<typeof mountPage>>) => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')
const issued2 = { ...issued, _id: 'ow4' }

describe('ScmOutwork.vue 收货回包晚到（G3）', () => {
  beforeEach(() => api.listOutworks.mockResolvedValue({ ok: true, list: [issued, issued2], hasMore: false }))

  it('大白话：没切表单——收货成功关表单、报应付', async () => {
    api.receiveOutwork.mockResolvedValue({ ok: true, payableFen: 600, lossQty: 0 })
    const w = await mountPage()
    await w.findAll('button').filter((b) => b.text() === '收货')[0].trigger('click')
    await btn(w, '确认收货（定格应付与损耗）').trigger('click')
    await flushPromises()
    expect(api.receiveOutwork.mock.calls[0][0]).toBe('ow1')
    expect(w.findAll('.recv-row')).toHaveLength(0)
    expect(status(w)).toBe('已收货入库：应付 ¥6.00 · 损耗 0 团（已定格）')
  })

  it('大白话：收货在途时已打开另一张收货表单——回包不关新表单、不写反馈，列表照刷', async () => {
    const recv = pending()
    api.receiveOutwork.mockReturnValue(recv.p)
    const w = await mountPage()
    await w.findAll('button').filter((b) => b.text() === '收货')[0].trigger('click')
    await btn(w, '确认收货（定格应付与损耗）').trigger('click')
    await w.findAll('button').filter((b) => b.text() === '收货')[1].trigger('click')
    const listCalls = api.listOutworks.mock.calls.length
    recv.release({ ok: false, status: 400, error: 'X' })
    await flushPromises()
    expect(w.text()).toContain('ow4 · 已按发料色预填')
    expect(status(w)).toBe('')
    expect(api.listOutworks.mock.calls.length).toBe(listCalls + 1)
  })
})

describe('ScmOutwork.vue 保存草稿回包晚到（H1）', () => {
  it('大白话：没切表单——保存成功关表单、报已更新', async () => {
    api.saveOutwork.mockResolvedValue({ ok: true })
    const w = await mountPage()
    await btn(w, '编辑').trigger('click')
    await w.find('input[placeholder="计件单价（元/团·可 0）"]').setValue('1.5')
    await btn(w, '保存草稿').trigger('click')
    await flushPromises()
    expect(api.saveOutwork).toHaveBeenCalledWith('', 150, [{ materialId: '', qty: 1 }], 'ow2')
    expect(w.text()).not.toContain('编辑外协草稿')
    expect(status(w)).toBe('外协草稿已更新')
  })

  it('大白话：保存在途时已点「新建外协单」——回包不关新表单、不写反馈，列表照刷', async () => {
    const save = pending()
    api.saveOutwork.mockReturnValue(save.p)
    const w = await mountPage()
    await btn(w, '编辑').trigger('click')
    await w.find('input[placeholder="计件单价（元/团·可 0）"]').setValue('1.5')
    await btn(w, '保存草稿').trigger('click')
    await btn(w, '新建外协单').trigger('click')
    const listCalls = api.listOutworks.mock.calls.length
    save.release({ ok: true })
    await flushPromises()
    expect(w.text()).toContain('新建外协草稿')
    expect(status(w)).toBe('')
    expect(api.listOutworks.mock.calls.length).toBe(listCalls + 1)
  })
})

describe('ScmOutwork.vue 列表乱序（D4）', () => {
  const rowIds = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll('.ld-tbody .ld-tr').map((r) => r.find('.mono').text())

  it('大白话：加载更多在途时列表被刷新——旧的下一页不再追加到新列表上', async () => {
    const w = await mountPage()
    const page2 = pending()
    api.listOutworks.mockReturnValueOnce(page2.p).mockResolvedValueOnce({ ok: true, list: [issued, { ...draft, status: 'issued' }], hasMore: false })
    await btn(w, '加载更多').trigger('click')
    await btn(w, '发料').trigger('click')
    await btn(w, '确认发料出库？').trigger('click')
    await flushPromises()
    page2.release({ ok: true, list: [{ _id: 'ow3', status: 'settled' }], nextCursor: 'c2', hasMore: true })
    await flushPromises()
    expect(rowIds(w)).toEqual(['ow1', 'ow2'])
    expect(w.text()).not.toContain('加载更多')
  })

  it('大白话：先发的刷新后回包，不覆盖后发刷新的列表', async () => {
    const w = await mountPage()
    const first = pending()
    api.cancelOutwork.mockResolvedValue({ ok: true })
    api.listOutworks.mockReturnValueOnce(first.p).mockResolvedValueOnce({ ok: true, list: [issued], hasMore: false })
    await btn(w, '发料').trigger('click')
    await btn(w, '确认发料出库？').trigger('click')
    await btn(w, '取消').trigger('click')
    await btn(w, '确认取消？').trigger('click')
    await flushPromises()
    first.release({ ok: true, list: [issued, draft, { _id: 'ow9', status: 'draft' }], hasMore: false })
    await flushPromises()
    expect(rowIds(w)).toEqual(['ow1'])
  })

  it('大白话：刷新在途时点加载更多——翻页不把在途的刷新作废，刷新结果照样落地', async () => {
    const w = await mountPage()
    const refresh = pending()
    api.listOutworks.mockReturnValueOnce(refresh.p).mockResolvedValueOnce({ ok: true, list: [{ _id: 'ow3', status: 'settled' }], hasMore: false })
    await btn(w, '发料').trigger('click')
    await btn(w, '确认发料出库？').trigger('click')
    await btn(w, '加载更多').trigger('click')
    await flushPromises()
    refresh.release({ ok: true, list: [issued], hasMore: false })
    await flushPromises()
    expect(rowIds(w)).toEqual(['ow1'])
  })
})
