// @vitest-environment happy-dom
// Fulfill.vue doShip：成功提示里的物流公司必须是实际提交给 shipOrder 的那一个——在途期操作员改下拉框不许串台。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listOrdersMock, shipOrderMock } = vi.hoisted(() => ({ listOrdersMock: vi.fn(), shipOrderMock: vi.fn() }))
vi.mock('../src/api/money', () => ({ listOrders: listOrdersMock, shipOrder: shipOrderMock }))

import Fulfill from '../src/pages/Fulfill.vue'

const OID = '2026070413011234'

describe('Fulfill.vue 发货提示与实际提交的物流公司一致', () => {
  it('大白话：用顺丰发出后、回包前改选中通，提示仍写顺丰', async () => {
    localStorage.clear()
    listOrdersMock.mockResolvedValue({
      ok: true,
      list: [{ id: OID, status: 'paid', amount: 100, createdAt: Date.now(), items: [{ name: '小熊', qty: 1 }], address: { name: '张三' } }],
      hasMore: false,
    })
    let release: (v: unknown) => void = () => {}
    shipOrderMock.mockReturnValue(new Promise((r) => (release = r)))
    const w = mount(Fulfill)
    await flushPromises()
    await w.findAll('.rail-step')[2].trigger('click')
    await flushPromises()

    const sel = w.find('select.sel')
    await sel.setValue('顺丰速运')
    const scan = w.find('input.scan-input')
    await scan.setValue(OID)
    await scan.trigger('keyup.enter')
    await scan.setValue('SF1234567890')
    await scan.trigger('keyup.enter')
    expect(shipOrderMock).toHaveBeenCalledWith(OID, '顺丰速运', 'SF1234567890')

    await sel.setValue('中通快递') // 在途改选
    release({ ok: true })
    await flushPromises()
    const msg = w.find('.scan-msg').text()
    expect(msg).toContain('已发货')
    expect(msg).toContain('顺丰速运')
    expect(msg).not.toContain('中通快递')
  })
})
