// @vitest-environment happy-dom
// Wizard.vue 回刷失败横幅：下次回刷成功要收回；但回刷成功不得清掉上架/恢复等动作反馈。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { freshDraft, restoreSaleOk } from '../src/lib/mapProducts'

const { listDraftsMock, republishProductMock } = vi.hoisted(() => ({ listDraftsMock: vi.fn(), republishProductMock: vi.fn() }))
vi.mock('../src/api/products', () => ({
  listDrafts: listDraftsMock,
  saveDraft: vi.fn(),
  publishProduct: vi.fn(),
  republishProduct: republishProductMock,
}))

import Wizard from '../src/pages/Wizard.vue'

const stubs = { Products: true, Courses: true, Cards: true, Batches: true }
const draft = { ...freshDraft('p-off'), name: '下架款', cover: 'c', price: '99', skus: [{ name: '标', price: '99' }] }
const okList = { ok: true, list: [draft], urls: {}, listed: { 'p-off': false }, hasVideo: {}, cardFinal: {}, hasBatch: {} }
const FAIL_TEXT = '网络开小差了，稍后再试'

async function mountAt(step: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/products/:id/wizard', component: Wizard }, { path: '/launch', component: Wizard }],
  })
  await router.push(`/products/p-off/wizard?step=${step}`)
  await router.isReady()
  const w = mount(Wizard, { global: { plugins: [router], stubs } })
  await flushPromises()
  const goStep = async (n: string) => {
    await router.push({ path: '/products/p-off/wizard', query: { step: n } })
    await flushPromises()
  }
  return { w, goStep }
}

beforeEach(() => {
  listDraftsMock.mockReset()
  republishProductMock.mockReset().mockResolvedValue({ ok: true })
})

describe('Wizard.vue 回刷失败横幅与动作反馈', () => {
  it('大白话：切步回刷失败出横幅，再切步回刷成功横幅消失', async () => {
    listDraftsMock.mockResolvedValueOnce(okList).mockResolvedValueOnce({ ok: false, error: FAIL_TEXT }).mockResolvedValue(okList)
    const { w, goStep } = await mountAt('1')
    await goStep('2')
    expect(w.find('.banner').text()).toBe(FAIL_TEXT)
    await goStep('3')
    expect(w.find('.banner').exists()).toBe(false)
  })

  it('大白话：回刷失败后点恢复销售成功，随后的回刷成功不清掉「已恢复」提示', async () => {
    listDraftsMock.mockResolvedValueOnce(okList).mockResolvedValueOnce({ ok: false, error: FAIL_TEXT }).mockResolvedValue(okList)
    const { w, goStep } = await mountAt('1')
    await goStep('2')
    expect(w.find('.banner').text()).toBe(FAIL_TEXT)
    await w.findAll('button').find((b) => b.text() === '恢复销售')!.trigger('click')
    await flushPromises()
    await w.findAll('button').find((b) => b.text().includes('上次上架页'))!.trigger('click')
    await flushPromises()
    expect(republishProductMock).toHaveBeenCalledTimes(1)
    expect(listDraftsMock).toHaveBeenCalledTimes(3)
    expect(w.find('.banner').text()).toBe(restoreSaleOk())
  })
})
