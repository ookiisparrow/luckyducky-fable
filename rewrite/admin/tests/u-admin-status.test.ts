// @vitest-environment happy-dom
// useLoadStatus.load(true) 只收回自己上次写的加载错误：重试成功后旧的「加载失败」横幅必须消失，
// 而动作反馈（note 写的、或页面直接写 message 的）不能被一次成功的后台刷新误清。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { useLoadStatus, confirmed } from '../src/lib/status'

const { listMaterialsMock, listSuppliersMock } = vi.hoisted(() => ({ listMaterialsMock: vi.fn(), listSuppliersMock: vi.fn() }))
vi.mock('../src/api/scm', () => ({
  listMaterials: listMaterialsMock,
  listSuppliers: listSuppliersMock,
  listLedger: vi.fn().mockResolvedValue({ ok: true, list: [] }),
  saveMaterial: vi.fn(),
  saveSupplier: vi.fn(),
  adjustStock: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/scm/materials', query: {} }) }))

import ScmMaterials from '../src/pages/ScmMaterials.vue'

describe('useLoadStatus 加载错误在重试成功后收回', () => {
  it('大白话：加载失败后再加载成功，失败横幅消失', () => {
    const s = useLoadStatus()
    s.load(false, '总览加载失败：NETWORK')
    expect(s.message.value).toBe('总览加载失败：NETWORK')
    s.load(true, '总览加载失败：')
    expect(s.message.value).toBe('')
  })

  it('大白话：加载失败后动作写了同样文案的失败，随后刷新成功也不清它', () => {
    const s = useLoadStatus()
    s.load(false, '网络波动，请重试')
    s.note(false, '', '网络波动，请重试')
    s.load(true, '')
    expect(s.message.value).toBe('网络波动，请重试')
  })

  it('大白话：加载失败后页面直接写了别的提示（如 409 冲突），随后刷新成功不清它', () => {
    const s = useLoadStatus()
    s.load(false, '加载失败：X')
    s.message.value = '这行库存刚被改过，刷新后再改'
    s.load(true, '')
    expect(s.message.value).toBe('这行库存刚被改过，刷新后再改')
  })

  it('大白话：收回过一次后，下一次成功刷新不再碰动作反馈', () => {
    const s = useLoadStatus()
    s.load(false, 'E')
    s.load(true, '')
    s.note(true, '已保存', '')
    s.load(true, '')
    expect(s.message.value).toBe('已保存')
  })
})

describe('ScmMaterials.vue 进盘点只查物料，不收回整页刷新报的供应商失败', () => {
  it('大白话：供应商加载失败后进入批量盘点（物料读成功），供应商失败提示仍在', async () => {
    listMaterialsMock.mockResolvedValue({ ok: true, list: [] })
    listSuppliersMock.mockResolvedValue({ ok: false, error: 'NETWORK' })
    const w = mount(ScmMaterials, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(w.text()).toContain('供应商加载失败')
    await w.findAll('button').find((b) => b.text().includes('批量盘点'))!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('供应商加载失败')
  })
})

describe('confirmed 两步确认', () => {
  it('大白话：第一次点只武装不放行；同一个再点放行并解除武装；中途点了别的就改武装那个', () => {
    const armed = ref('')
    expect(confirmed(armed, 'd:1')).toBe(false)
    expect(armed.value).toBe('d:1')
    expect(confirmed(armed, 'd:2')).toBe(false)
    expect(armed.value).toBe('d:2')
    expect(confirmed(armed, 'd:2')).toBe(true)
    expect(armed.value).toBe('')
    expect(confirmed(armed, 'd:2')).toBe(false)
  })
})
