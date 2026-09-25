// @vitest-environment happy-dom
// Inventory.vue doSave 在途闸：回包前再按保存/Enter 不许二发——同一 expectedUpdatedAt 二发必 409，成功后显假冲突。
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
