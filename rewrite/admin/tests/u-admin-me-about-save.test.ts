// @vitest-environment happy-dom
// MeAboutTab：手工保存失败后，只有两边自动保存都落到 saved 才撤失败提示。
// 一边还在保存中、或另一边仍是空，都不能清；失败句也不能被成功句换掉。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { SAVE_OK_MESSAGE } from '../src/lib/mapPageContent'

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

async function clickSave() {
  await w!.findAll('button').find((b) => b.text() === '保存')!.trigger('click')
  await flushPromises()
}

/** 失败还挂着：红条、失败句在，成功句不顶上来。 */
function expectFailureStays() {
  const text = w!.text()
  expect(text).toContain('自动保存失败')
  expect(text).toContain('保存失败（X）')
  expect(text).not.toContain(SAVE_OK_MESSAGE)
  expect(text).not.toContain('已自动保存')
}

describe('MeAboutTab 手工保存失败后的自动保存', () => {
  it('大白话：只改一边时失败还在；两边都自动保存成功了才撤掉', async () => {
    savePageContent.mockImplementation(async (page: string) =>
      page === 'mePage' ? { ok: false, error: 'X' } : { ok: true },
    )
    w = mount(MeAboutTab)
    await flushPromises()
    await clickSave()
    expectFailureStays()

    savePageContent.mockResolvedValue({ ok: true })
    await w.find('input').setValue('新昵称')
    await flushPromises()
    // 「我」页刚进入保存中，关于我们仍是手工保存后的空状态
    expectFailureStays()

    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    // 「我」页这一边已经存上，关于我们还没再存成功
    expectFailureStays()

    await w.find('textarea').setValue('新引言')
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()

    const text = w.text()
    expect(text).toContain('已自动保存')
    expect(text).not.toContain('自动保存失败')
    expect(text).not.toContain('保存失败（X）')
  })

  it('大白话：两边手工保存都失败时，只修好一边，另一边的失败句还留着', async () => {
    savePageContent.mockResolvedValue({ ok: false, error: 'X' })
    w = mount(MeAboutTab)
    await flushPromises()
    await clickSave()
    expect(w.text()).toContain('「我」页：保存失败（X）')
    expect(w.text()).toContain('「关于我们」：保存失败（X）')

    savePageContent.mockResolvedValue({ ok: true })
    await w.find('input').setValue('新昵称')
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()

    const text = w.text()
    expect(text).toContain('自动保存失败')
    expect(text).toContain('「关于我们」：保存失败（X）')
    expect(text).not.toContain(SAVE_OK_MESSAGE)
    expect(text).not.toContain('已自动保存')
  })

  it('大白话：改完一边、自动保存又失败，不能改挂成功句', async () => {
    savePageContent.mockImplementation(async (page: string) =>
      page === 'mePage' ? { ok: false, error: 'X' } : { ok: true },
    )
    w = mount(MeAboutTab)
    await flushPromises()
    await clickSave()

    await w.find('input').setValue('新昵称')
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    expectFailureStays()
  })
})
