import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as trackEvent } from '../../packages/cloud/src/functions/learning/trackEvent'

// 根因#13 P2：用户端写函数按 openid 限频（withRateLimit），防无限刷库/堆垃圾/成本。
beforeEach(() => {
  control.reset()
  control.setOpenId('u1')
})

describe('用户端写函数频控（根因#13 · withRateLimit）', () => {
  it('trackEvent 超 60 次/分即 RATE_LIMITED（前 60 放行）', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await trackEvent({ type: 'view', page: 'home' })).error).toBeUndefined()
    }
    expect((await trackEvent({ type: 'view', page: 'home' })).error).toBe('RATE_LIMITED')
  })

  it('频控按 openid 隔离：u1 被限不影响 u2', async () => {
    for (let i = 0; i < 61; i++) await trackEvent({ type: 'view' })
    expect((await trackEvent({ type: 'view' })).error).toBe('RATE_LIMITED') // u1 仍超
    control.setOpenId('u2')
    expect((await trackEvent({ type: 'view' })).error).toBeUndefined() // u2 全新计数
  })
})
