// v5 按键手感（lib/keyFx·老板 2026-09-28「按设计稿实现」）：按下震+咔嗒，一次点按只震一下。
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Ev = WechatMiniprogram.TouchEvent
const ev = (k?: string) => ({ currentTarget: { dataset: k ? { k } : {} } }) as unknown as Ev
const vibrateShort = vi.fn()
beforeEach(() => {
  vi.resetModules()
  vibrateShort.mockReset()
  ;(globalThis as Record<string, unknown>).wx = { vibrateShort }
})

describe('keyFx 按键手感', () => {
  it('大白话：主键按下 medium、浅键 light；按下后同一次点按里处理器再调 tapHaptic 不叠第二下震', async () => {
    vi.useFakeTimers()
    const { keyDown } = await import('../lib/keyFx')
    const { tapHaptic } = await import('../lib/haptics')
    keyDown(ev('ink'))
    tapHaptic()
    expect(vibrateShort.mock.calls).toEqual([[{ type: 'medium' }]])
    vi.advanceTimersByTime(1000)
    keyDown(ev('light'))
    vi.useRealTimers()
    expect(vibrateShort.mock.calls[1]).toEqual([{ type: 'light' }])
  })

  it('大白话：没有音频能力（老基础库/测试环境）只震不响、不抛错', async () => {
    const { keyUp, keyDown } = await import('../lib/keyFx')
    expect(() => keyUp(ev())).not.toThrow()
    expect(() => keyDown(ev('dk'))).not.toThrow()
  })

  it('大白话：禁用态键（hover-class 为 none/空 → data-k 为 none/空）按下不震', async () => {
    const { keyDown } = await import('../lib/keyFx')
    keyDown(ev('none'))
    keyDown(ev())
    expect(vibrateShort).not.toHaveBeenCalled()
  })

  it('大白话：有音频时墨黑键按下叠低频「咚」、浅键不叠；行/卡片只震不响', async () => {
    const node = () => ({
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      Q: { value: 0 },
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    })
    const src = vi.fn(node)
    const osc = vi.fn(node)
    ;(globalThis as Record<string, unknown>).wx = {
      vibrateShort,
      createWebAudioContext: () => ({
        currentTime: 0,
        sampleRate: 1000,
        destination: {},
        createBuffer: () => ({ getChannelData: () => new Float32Array(40) }),
        createBufferSource: src,
        createBiquadFilter: node,
        createGain: node,
        createOscillator: osc,
      }),
    }
    const { click } = await import('../lib/keyFx')
    click('light', true)
    expect([src.mock.calls.length, osc.mock.calls.length]).toEqual([1, 0])
    click('ink', true)
    expect([src.mock.calls.length, osc.mock.calls.length]).toEqual([2, 1])
    click('row', true)
    click('card', false)
    expect([src.mock.calls.length, osc.mock.calls.length]).toEqual([2, 1])
  })
})
