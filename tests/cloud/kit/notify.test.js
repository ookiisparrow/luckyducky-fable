import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { defineNotifyCallback } from '../../../packages/cloud/src/kit'

// kit.defineNotifyCallback 反向测试（根因账本 #3）：去掉防伪闸，第 1 例必红。
const ACK = { errcode: 0 }
beforeEach(() => {
  control.reset()
  control.setOpenId('') // 工作流服务端调用无用户上下文
})

describe('kit.defineNotifyCallback（回调框架）', () => {
  it('带用户身份（伪造）→ 不调 onNotify，返回 ack（防伪闸）', async () => {
    control.setOpenId('attacker')
    const onNotify = vi.fn()
    const fn = defineNotifyCallback({ ack: ACK, refId: () => 'x', onNotify })
    expect(await fn({})).toBe(ACK)
    expect(onNotify).not.toHaveBeenCalled()
  })

  it('refId 空（缺单号）→ ack，不调 onNotify', async () => {
    const onNotify = vi.fn()
    const fn = defineNotifyCallback({ ack: ACK, refId: () => '', onNotify })
    expect(await fn({})).toBe(ACK)
    expect(onNotify).not.toHaveBeenCalled()
  })

  it('有单号 → 调 onNotify（注入 db/id/event），返回 ack', async () => {
    const seen = {}
    const fn = defineNotifyCallback({
      ack: ACK,
      refId: () => 'ord1',
      onNotify: async (ctx) => {
        Object.assign(seen, { id: ctx.id, hasDb: typeof ctx.db.collection === 'function' })
      },
    })
    expect(await fn({ foo: 1 })).toBe(ACK)
    expect(seen.id).toBe('ord1')
    expect(seen.hasDb).toBe(true)
  })
})
