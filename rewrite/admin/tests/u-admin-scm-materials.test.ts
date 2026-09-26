// @vitest-environment happy-dom
// ScmMaterials.vue：批量盘点只提交有差异的行；分路加载失败各报各的原因；
// 供应商保存回包前已切到别的供应商，反馈与复位不打到新表单上。
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
    const no = w.find('.stocktake-no b').text()
    expect(no).toMatch(/^ST-\d{8}-\d{4}$/)
    expect(api.adjustStock.mock.calls[0].slice(2)).toEqual([`期初盘点（${no}）`, `${no}-m1`]) // 幂等键＝单号-料号
  })

  const enterAndFill = async () => {
    const w = await mountPage()
    await w.findAll('button').find((b) => b.text().includes('批量盘点'))!.trigger('click')
    await flushPromises()
    const inputs = w.findAll('input.stocktake-actual')
    await inputs[0].setValue(3)
    await inputs[1].setValue(9)
    return w
  }
  const submitBtn = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll('button').find((b) => /^提交(盘点|中)/.test(b.text()))!

  it('大白话：一行成功一行失败——成功行不再计入待提交、再点提交只重发失败行；提交过的行实盘框锁死，没盘的行照常能填', async () => {
    api.adjustStock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'X' })
    const w = await enterAndFill()
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(submitBtn(w).text()).toBe('提交盘点（1）')
    const inputs = w.findAll('input.stocktake-actual')
    expect(inputs.map((i) => i.attributes('disabled') !== undefined)).toEqual([true, true, false])

    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(api.adjustStock.mock.calls.map((c) => c[0])).toEqual(['m1', 'm2', 'm2'])
  })

  it('大白话：单行重试在途时，「提交盘点」也锁住，不跟重试并发碰同一行', async () => {
    api.adjustStock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'X' })
    const w = await enterAndFill()
    await submitBtn(w).trigger('click')
    await flushPromises()
    await w.findAll('input.stocktake-actual')[2].setValue(1) // 第三行还有待提交的差异
    let release: (v: unknown) => void = () => {}
    api.adjustStock.mockReturnValueOnce(new Promise((r) => (release = r)))
    await w.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    expect(submitBtn(w).attributes('disabled')).toBeDefined()
    release({ ok: true })
    await flushPromises()
    expect(w.find('.stocktake-summary').text()).toContain('已提交 2 成功 / 0 失败')
    expect(submitBtn(w).text()).toBe('提交盘点（1）')
    expect(submitBtn(w).attributes('disabled')).toBeUndefined()
  })
})

describe('ScmMaterials.vue 建档表单', () => {
  it('大白话：大团选了「带结」再把档位切成中团——形态自动回「原团」，不留一个下拉里已没有的值', async () => {
    const w = await mountPage()
    const [tier, form] = w.findAll('.scm-form select').filter((s) => ['L', 'raw'].includes((s.element as HTMLSelectElement).value))
    await form.setValue('knotted')
    await tier.setValue('M')
    expect((form.element as HTMLSelectElement).value).toBe('raw')
  })
})

describe('ScmMaterials.vue 加载更多', () => {
  const more = (w: Awaited<ReturnType<typeof mountPage>>, i: number) => w.findAll('button').filter((b) => b.text() === '加载更多')[i]

  it('大白话：供应商、流水各自续传自己的游标，新页接在后面', async () => {
    api.listSuppliers.mockResolvedValueOnce({ ok: true, list: [{ _id: 's1', name: '甲厂', type: 'factory' }], nextCursor: 'sc1', hasMore: true })
    api.listLedger.mockResolvedValueOnce({ ok: true, list: [{ _id: 'l1', itemKey: 'm1', delta: 1, docType: 'adjust', at: 1 }], nextCursor: 'lc1', hasMore: true })
    const w = await mountPage()
    api.listSuppliers.mockResolvedValueOnce({ ok: true, list: [{ _id: 's2', name: '乙厂', type: 'factory' }], hasMore: false })
    await more(w, 0).trigger('click')
    await flushPromises()
    expect(api.listSuppliers).toHaveBeenLastCalledWith({ cursor: 'sc1' })
    expect(w.findAll('.sup-line .sup-name').map((n) => n.text())).toEqual(['甲厂', '乙厂'])

    api.listLedger.mockResolvedValueOnce({ ok: true, list: [{ _id: 'l2', itemKey: 'm1', delta: -1, docType: 'adjust', at: 2 }], hasMore: false })
    await more(w, 0).trigger('click')
    await flushPromises()
    expect(api.listLedger).toHaveBeenLastCalledWith(undefined, { cursor: 'lc1' })
    expect(w.findAll('.ld-tbody .ld-tr').length).toBe(3 + 2) // 物料 3 行 + 流水 2 行
  })
})

describe('ScmMaterials.vue 分路加载报错', () => {
  it('大白话：物料和供应商都挂，两条原因按顺序用「；」连起来，业务码给中文兜底', async () => {
    api.listMaterials.mockResolvedValue({ ok: false, error: 'A' })
    api.listSuppliers.mockResolvedValue({ ok: false, error: 'B' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toBe('物料主档加载失败：操作没成功（A）；供应商加载失败：操作没成功（B）')
  })

  it('大白话：只有供应商挂，只报供应商', async () => {
    api.listSuppliers.mockResolvedValue({ ok: false, error: 'B' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toBe('供应商加载失败：操作没成功（B）')
  })

  it('大白话：物料读被业务码拒，提示是中文，不裸甩码', async () => {
    api.listMaterials.mockResolvedValue({ ok: false, status: 403, error: 'FORBIDDEN' })
    const w = await mountPage()
    expect(w.find('.ld-status').text()).toMatch(/^物料主档加载失败：[一-鿿]/)
  })
})

describe('ScmMaterials.vue 供应商保存回包晚到（H1）', () => {
  const sups = { ok: true, list: [{ _id: 's1', name: '甲厂', type: 'factory' }, { _id: 's2', name: '乙厂', type: 'factory' }] }
  const nameInput = (w: Awaited<ReturnType<typeof mountPage>>) => w.findAll('input[placeholder="名称"]')[1] // [0] 是物料建档的名称框
  const status = (w: Awaited<ReturnType<typeof mountPage>>) => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')

  it('大白话：没切供应商——更新成功报「已更新」、表单复位', async () => {
    api.listSuppliers.mockResolvedValue(sups)
    api.saveSupplier.mockResolvedValue({ ok: true })
    const w = await mountPage()
    await w.findAll('.sup-line')[0].trigger('click')
    await nameInput(w).setValue('甲厂二号')
    await w.findAll('button').find((b) => b.text() === '更新')!.trigger('click')
    await flushPromises()
    expect(api.saveSupplier).toHaveBeenCalledWith({ supplierId: 's1', name: '甲厂二号', type: 'factory', contact: '', note: '' })
    expect(status(w)).toBe('供应商已更新')
    expect((nameInput(w).element as HTMLInputElement).value).toBe('')
  })

  it('大白话：保存在途时已点开另一家——回包不复位新表单、不写反馈，列表照刷', async () => {
    api.listSuppliers.mockResolvedValue(sups)
    let release: (v: unknown) => void = () => {}
    api.saveSupplier.mockReturnValue(new Promise((r) => (release = r)))
    const w = await mountPage()
    await w.findAll('.sup-line')[0].trigger('click')
    await w.findAll('button').find((b) => b.text() === '更新')!.trigger('click')
    await w.findAll('.sup-line')[1].trigger('click')
    const listCalls = api.listSuppliers.mock.calls.length
    release({ ok: true })
    await flushPromises()
    expect((nameInput(w).element as HTMLInputElement).value).toBe('乙厂')
    expect(status(w)).toBe('')
    expect(api.listSuppliers.mock.calls.length).toBeGreaterThan(listCalls)
  })
})

describe('ScmMaterials.vue 读失败不装空（失败≠空态）', () => {
  const clickText = async (w: Awaited<ReturnType<typeof mountPage>>, t: string) => {
    await w.findAll('button').find((b) => b.text().includes(t))!.trigger('click')
    await flushPromises()
  }

  it('大白话：物料主档读失败，表里不显「还没有物料档」、KPI 不画 0，并说出人话原因', async () => {
    api.listMaterials.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:boom' })
    const w = await mountPage()
    expect(w.text()).not.toContain('还没有物料档')
    expect(w.find('.ld-kpi-grid').exists()).toBe(false)
    expect(w.text()).not.toContain('物料主档（0）')
    expect(w.text()).toContain('物料主档加载失败')
    expect(w.text()).toContain('网络不通')
  })

  it('大白话：供应商读失败，KPI 不画「0 家」，物料的供应商列不显「—」冒充没挂', async () => {
    api.listMaterials.mockResolvedValue({ ok: true, list: [{ ...mat('m1', 5), supplierId: 's1' }] })
    api.listSuppliers.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:boom' })
    const w = await mountPage()
    expect(w.find('.ld-kpi-grid').text()).not.toContain('供应商 / 织女0')
    expect(w.find('.sup-cell .sup-name').text()).toBe('读取失败')
  })

  it('大白话：进批量盘点时物料读超时，不显「没有物料档可盘点」，也不甩英文码', async () => {
    const w = await mountPage()
    api.listMaterials.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    await clickText(w, '批量盘点')
    expect(w.text()).not.toContain('没有物料档可盘点')
    expect(w.text()).toContain('服务器太久没回话')
    expect(w.text()).not.toContain('CALL_TIMEOUT')
  })

  it('大白话：流水读失败说人话，不甩英文码', async () => {
    api.listLedger.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:boom' })
    const w = await mountPage()
    expect(w.find('.ledger-err').text()).toBe('流水加载失败：网络不通，请检查网络后重试。')
    expect(w.text()).not.toContain('还没有库存流水')
  })

  it('大白话：物料读回来了但确实一条没有，照常显示空态', async () => {
    api.listMaterials.mockResolvedValue({ ok: true, list: [] })
    const w = await mountPage()
    expect(w.text()).toContain('还没有物料档')
    await clickText(w, '批量盘点')
    expect(w.text()).toContain('没有物料档可盘点')
  })
})

describe('ScmMaterials.vue 物料先读挂、进盘点再读成功', () => {
  it('大白话：KPI 按这次读到的物料数显示，不再按上次失败画 0', async () => {
    api.listMaterials.mockResolvedValueOnce({ ok: false, status: 0, error: 'NETWORK:boom' })
    const w = await mountPage()
    expect(w.find('.ld-kpi-grid').exists()).toBe(false)
    await w.findAll('button').find((b) => b.text().includes('批量盘点'))!.trigger('click')
    await flushPromises()
    expect(w.find('.ld-kpi-grid').text()).toContain('物料数3')
    expect(w.findAll('input.stocktake-actual')).toHaveLength(3)
    expect(w.text()).not.toContain('物料主档加载失败')
  })
})
