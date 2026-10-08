// 「继续观看」兜底落首页回顶（mp-7fixes 批3）：我页无课兜底 / welcome「先逛逛」落 tab 页时，
// tab 页实例常驻保留的上次滚动位置可能恰好停在首页 FAQ 板块，落地视口顶部观感=「弹出大家都在问」。
// homeIntent 是这两处兜底跳转与首页 onShow 之间的一次性标记：request 置位、home onShow consume 读即清。
import { describe, it, expect } from 'vitest'
import { requestHomeTop, consumeHomeTop } from '../lib/homeIntent'

describe('homeIntent 纯逻辑：读即清，只消费一次', () => {
  it('大白话：默认未置位 → consume 返回 false', () => {
    expect(consumeHomeTop()).toBe(false)
  })

  it('大白话：request 后 consume 一次 true，第二次读回 false（标记已清）', () => {
    requestHomeTop()
    expect(consumeHomeTop()).toBe(true)
    expect(consumeHomeTop()).toBe(false)
  })

  it('大白话：连续 request 两次仍只消费一次（读即清语义·不累加）', () => {
    requestHomeTop()
    requestHomeTop()
    expect(consumeHomeTop()).toBe(true)
    expect(consumeHomeTop()).toBe(false)
  })
})
