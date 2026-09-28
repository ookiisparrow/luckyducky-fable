// @vitest-environment happy-dom
// MeAboutTab：手工保存失败后，两边自动保存都不再失败时，要撤掉「自动保存失败」和旧失败句。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const { getPageContent, savePageContent } = vi.hoisted(() => ({
  getPageContent: vi.fn(),
  savePageContent: vi.fn(),
}))
vi.mock('../src/api/content', () => ({ getPageContent, savePageContent }))

import MeAboutTab from '../src/components/pagecontent/MeAboutTab.vue'

let w: VueWrapper | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  getPageContent.mockReset().mockImplementation(async (page: string) => ({
    ok: true,
    content: page === 'about' ? { lead: '引言', sections: [] } : { defaultNickname: '小棉鸭用户', entries: [] },
  }))
  savePageContent.mockReset().mockResolvedValue({ ok: true })
})
afterEach(async () => {
  w?.unmount()
  w = undefined
  await flushPromises()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('MeAboutTab 手工保存失败后的自动保存', () => {
  it('大白话：点保存有一边失败后，两边自动保存都成功了，不再挂「自动保存失败」和旧失败句', async () => {
    savePageContent.mockImplementation(async (page: string) =>
      page === 'mePage' ? { ok: false, error: 'X' } : { ok: true },
    )
    w = mount(MeAboutTab)
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('自动保存失败')
    expect(w.text()).toContain('保存失败')

    savePageContent.mockResolvedValue({ ok: true })
    await w.find('input').setValue('新昵称')
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()

    expect(w.text()).toContain('已自动保存')
    expect(w.text()).not.toContain('自动保存失败')
    expect(w.text()).not.toContain('保存失败')
  })
})
