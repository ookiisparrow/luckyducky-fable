// @vitest-environment happy-dom
// Reviews.vue 上架/撤下接线：点按钮须真调 setReviewPicked，不是只改文案。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

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
