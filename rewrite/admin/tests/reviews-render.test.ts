// @vitest-environment happy-dom
// Reviews.vue 上架/撤下接线：点按钮须真调 setReviewPicked，不是只改文案。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'

const { listReviewsMock, setReviewPickedMock } = vi.hoisted(() => ({
  listReviewsMock: vi.fn(),
  setReviewPickedMock: vi.fn(),
}))
vi.mock('../src/api/reviews', () => ({
  listReviews: listReviewsMock,
  setReviewPicked: setReviewPickedMock,
}))

import Reviews from '../src/pages/Reviews.vue'

beforeEach(() => {
  listReviewsMock.mockReset().mockResolvedValue({
    ok: true,
    list: [
      {
        id: 'pend',
        productId: 'p1',
        name: '鸭友',
        rating: 5,
        tags: [],
        text: '待审评',
        spec: '红',
        createdAt: 1783046400000,
        photos: [],
        picked: false,
      },
    ],
    nextCursor: null,
    hasMore: false,
  })
  setReviewPickedMock.mockReset().mockResolvedValue({ ok: true, picked: true })
})

describe('Reviews.vue 挑选开关', () => {
  it('大白话：待挑选行点「上架」会调 setReviewPicked(id, true)，不是只改按钮字', async () => {
    const wrapper = mount(Reviews)
    await flushPromises()
    expect(wrapper.text()).toContain('待审评')
    expect(wrapper.text()).toContain('待挑选')
    const btn = wrapper.findAll('button').find((b) => b.text() === '上架')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    expect(setReviewPickedMock).toHaveBeenCalledTimes(1)
    expect(setReviewPickedMock).toHaveBeenCalledWith('pend', true)
  })
})

describe('Reviews.vue 失败提示', () => {
  it('大白话：没权限说加载失败并讲清是权限，不显空态', async () => {
    listReviewsMock.mockResolvedValue({ ok: false, status: 403, error: 'FORBIDDEN' })
    const wrapper = mount(Reviews)
    await flushPromises()
    expect(wrapper.find('.ld-status').text()).toBe('加载失败：' + transportErrorText('FORBIDDEN'))
    expect(wrapper.text()).not.toContain('这一档还没有评价')
  })

  it('大白话：上架超时说人话，不甩 CALL_TIMEOUT', async () => {
    setReviewPickedMock.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const wrapper = mount(Reviews)
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '上架')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.ld-status').text()).toBe(transportErrorText('CALL_TIMEOUT'))
  })
})
