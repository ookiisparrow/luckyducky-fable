// @vitest-environment happy-dom
// ConfigChecklist.vue 保存成功但随后的整页刷新失败：不许卡在「保存中」锁死整页，也不许用「已保存」盖掉刷新失败。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { getConfigChecklistMock, savePayConfigMock } = vi.hoisted(() => ({ getConfigChecklistMock: vi.fn(), savePayConfigMock: vi.fn() }))
vi.mock('../src/api/system', () => ({
  getConfigChecklist: getConfigChecklistMock,
  saveSecureConfig: vi.fn(),
  savePayConfig: savePayConfigMock,
}))

import ConfigChecklist from '../src/pages/ConfigChecklist.vue'

const item = (key: string) => ({
  key,
  name: key,
  location: 'db',
  purpose: 'p',
  status: 'missing',
  howTo: 'h',
  url: '',
  fill: { action: 'savePayConfig', field: key, inputType: 'text' },
})

describe('ConfigChecklist.vue 保存后刷新失败不锁页', () => {
  it('大白话：保存成功、刷新失败时，保存按钮不再卡「保存中…」，提示说清已保存但刷新失败', async () => {
    getConfigChecklistMock
      .mockResolvedValueOnce({ ok: true, groups: [{ group: '支付', items: [item('mchId'), item('mode')] }] })
      .mockResolvedValue({ ok: false, error: 'NETWORK:boom' })
    savePayConfigMock.mockResolvedValue({ ok: true })
    const w = mount(ConfigChecklist)
    await flushPromises()
    await w.findAll('input.fill-input')[0].setValue('123')
    await w.findAll('.row-fill button')[0].trigger('click')
    await flushPromises()
    expect(savePayConfigMock).toHaveBeenCalledTimes(1)
    expect(w.text()).not.toContain('保存中…')
    expect(w.find('.ld-status').text()).toContain('刷新失败')
    await w.findAll('input.fill-input')[1].setValue('real')
    expect(w.findAll('.row-fill button')[1].attributes('disabled')).toBeUndefined() // 别的项仍可保存
  })

  it('大白话：保存后刷新在途时，其它项仍被全局锁住，不能同时提交', async () => {
    let release: (v: unknown) => void = () => {}
    getConfigChecklistMock
      .mockResolvedValueOnce({ ok: true, groups: [{ group: '支付', items: [item('mchId'), item('mode')] }] })
      .mockReturnValueOnce(new Promise((r) => (release = r)))
    savePayConfigMock.mockResolvedValue({ ok: true })
    const w = mount(ConfigChecklist)
    await flushPromises()
    await w.findAll('input.fill-input')[1].setValue('real')
    await w.findAll('input.fill-input')[0].setValue('123')
    await w.findAll('.row-fill button')[0].trigger('click')
    await flushPromises()
    expect(w.findAll('.row-fill button')[1].attributes('disabled')).toBeDefined()
    release({ ok: false, error: 'NETWORK:boom' })
    await flushPromises()
  })
})
