// @vitest-environment happy-dom
// Inventory.vue doSave 在途闸：回包前再按保存/Enter 不许二发——同一 expectedUpdatedAt 二发必 409，成功后显假冲突；
// 保存回包前已切到别行编辑，成功不收起新行的编辑态。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listInventoryMock, saveStockMock } = vi.hoisted(() => ({ listInventoryMock: vi.fn(), saveStockMock: vi.fn() }))
vi.mock('../src/api/system', () => ({ listInventory: listInventoryMock, saveStock: saveStockMock }))
vi.mock('../src/api/products', () => ({ listDrafts: vi.fn().mockResolvedValue({ ok: true, list: [] }) }))

import Inventory from '../src/pages/Inventory.vue'

describe('Inventory.vue 保存在途不二发', () => {
  it('大白话：保存回包前连按两次，只发一次 saveStock，成功后不显冲突', async () => {
    listInventoryMock.mockResolvedValue({ ok: true, list: [{ _id: 's1', productId: 'p1', spec: '', stock: 5, updatedAt: 100 }] })
    let release: (v: unknown) => void = () => {}
    saveStockMock.mockReturnValueOnce(new Promise((r) => (release = r))).mockResolvedValue({ ok: false, status: 409, error: 'STOCK_CONFLICT' })
    const w = mount(Inventory)
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === '调整')!.trigger('click')
    const save = () => w.findAll('button').find((b) => b.text() === '保存')!
    await save().trigger('click')
    await w.find('input.stockin').trigger('keyup.enter')
    await save().trigger('click')
    release({ ok: true })
    await flushPromises()
    expect(saveStockMock).toHaveBeenCalledTimes(1)
    expect(w.text()).not.toContain('刚被改过')
  })
})

describe('Inventory.vue 状态筛选与徽章', () => {
  it('大白话：筛选条按 全部/在售/低库存/售罄/不限量 排、各带条数；每行徽章文字与颜色对得上', async () => {
    listInventoryMock.mockResolvedValue({
      ok: true,
      list: [
        { _id: 'a', productId: 'p1', stock: 50, updatedAt: 1 },
        { _id: 'b', productId: 'p2', stock: 3, updatedAt: 1 },
        { _id: 'c', productId: 'p3', stock: 0, updatedAt: 1 },
        { _id: 'd', productId: 'p4', stock: null, updatedAt: 1 },
        { _id: 'e', productId: 'p5', stock: 2, updatedAt: 1 },
      ],
    })
    const w = mount(Inventory)
    await flushPromises()
    expect(w.findAll('.ld-chip').map((c) => c.text())).toEqual(['全部5', '在售1', '低库存2', '售罄1', '不限量1'])
    expect(w.findAll('.badge').map((b) => b.classes().find((c) => c.startsWith('t-')) + ':' + b.text())).toEqual([
      't-green:在售',
      't-amber:低库存',
      't-red:售罄',
      't-brand:不限量',
      't-amber:低库存',
    ])
  })
})

describe('Inventory.vue 自设低库存阈值', () => {
  it('大白话：设了自己的阈值按自己的算（15≤20 算低库存、5>3 算在售），没设才退默认；与看板同一把尺子', async () => {
    listInventoryMock.mockResolvedValue({
      ok: true,
      list: [
        { _id: 'a', productId: 'p1', stock: 15, threshold: 20, updatedAt: 1 },
        { _id: 'b', productId: 'p2', stock: 5, threshold: 3, updatedAt: 1 },
        { _id: 'c', productId: 'p3', stock: 8, threshold: 0, updatedAt: 1 },
      ],
    })
    const w = mount(Inventory)
    await flushPromises()
    expect(w.findAll('.badge').map((b) => b.text())).toEqual(['低库存', '在售', '低库存'])
  })
})

describe('Inventory.vue 保存回包前切到别行（G4）', () => {
  const two = { ok: true, list: [{ _id: 's1', productId: 'p1', spec: '', stock: 5, updatedAt: 100 }, { _id: 's2', productId: 'p2', spec: '', stock: 7, updatedAt: 100 }] }
  const adjust = (w: ReturnType<typeof mount>, i: number) => w.findAll('button').filter((b) => b.text() === '调整')[i].trigger('click')

  it('大白话：没切行——保存成功收起编辑态', async () => {
    listInventoryMock.mockResolvedValue(two)
    saveStockMock.mockReset().mockResolvedValue({ ok: true })
    const w = mount(Inventory)
    await flushPromises()
    await adjust(w, 0)
    await w.findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()
    expect(saveStockMock).toHaveBeenCalledWith('p1', '', 5, 100, 0)
    expect(w.find('input.stockin').exists()).toBe(false)
  })

  it('大白话：保存在途时已点开另一行——成功回包不收起那一行的编辑', async () => {
    listInventoryMock.mockResolvedValue(two)
    let release: (v: unknown) => void = () => {}
    saveStockMock.mockReset().mockReturnValueOnce(new Promise((r) => (release = r)))
    const w = mount(Inventory)
    await flushPromises()
    await adjust(w, 0)
    await w.findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await adjust(w, 0) // 第一行已进编辑态，剩下的「调整」就是第二行的
    release({ ok: true })
    await flushPromises()
    expect(w.findAll('input.stockin')).toHaveLength(1)
    expect((w.find('input.stockin').element as HTMLInputElement).value).toBe('7')
  })
})

describe('Inventory.vue 读失败说人话', () => {
  it.each([
    ['NETWORK:Failed to fetch', '加载失败：网络不通，请检查网络后重试。'],
    ['X1', '加载失败（X1）'],
  ])('大白话：库存读失败 %s 显示「%s」', async (code, text) => {
    listInventoryMock.mockResolvedValue({ ok: false, status: 0, error: code })
    const w = mount(Inventory)
    await flushPromises()
    expect(w.find('.msg-err').text()).toBe(text)
    expect(w.find('.ld-kpi-grid').exists()).toBe(false) // 读失败不把四张 KPI 画成 0
  })
})
