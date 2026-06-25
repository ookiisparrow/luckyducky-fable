import { describe, it, expect } from 'vitest'
import { createPlaybackResolver } from '@/utils/playbackCache.js'

// 分段视频播放地址解析器：缓存（按 segId+TTL）+ 预取 + in-flight 去重（治真机段间转场卡顿·根因#8）。
// 纯函数工厂，fetcher/now 注入 → 缓存命中/过期/去重/预取边界可单测，不依赖云端/计时器。

// 计数 fetcher：每次调用 +1，返回该段的「第 N 版」临时 URL（验证有没有重复取址）
function counting() {
  const calls = {}
  const fn = (segId) => {
    calls[segId] = (calls[segId] || 0) + 1
    return Promise.resolve(`url:${segId}:${calls[segId]}`)
  }
  fn.count = (segId) => calls[segId] || 0
  return fn
}

describe('createPlaybackResolver 缓存', () => {
  it('TTL 内第二次 load 命中缓存、不再取址', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => 0 })
    expect(await r.load('s1')).toBe('url:s1:1')
    expect(await r.load('s1')).toBe('url:s1:1') // 同一版本=没重取
    expect(fetcher.count('s1')).toBe(1)
  })

  it('过期后 load 重新取址', async () => {
    const fetcher = counting()
    let t = 0
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => t })
    expect(await r.load('s1')).toBe('url:s1:1')
    t = 1500 // 越过 TTL
    expect(await r.load('s1')).toBe('url:s1:2') // 第二版=重取了
    expect(fetcher.count('s1')).toBe(2)
  })

  it('空 segId → 空串、不取址', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher })
    expect(await r.load('')).toBe('')
    expect(fetcher.count('')).toBe(0)
  })

  it('取址返回空（素材未剪/未授权）不缓存，下次仍重试', async () => {
    let n = 0
    const fetcher = (segId) => Promise.resolve(n++ === 0 ? '' : `url:${segId}`)
    const r = createPlaybackResolver({ fetcher, now: () => 0 })
    expect(await r.load('s1')).toBe('') // 首次空
    expect(await r.load('s1')).toBe('url:s1') // 没被缓存为空 → 重试拿到真地址
  })
})

describe('createPlaybackResolver in-flight 去重', () => {
  it('并发 load 同段只取一次址', async () => {
    let calls = 0
    let resolve
    const fetcher = () => {
      calls++
      return new Promise((res) => (resolve = res))
    }
    const r = createPlaybackResolver({ fetcher, now: () => 0 })
    const p1 = r.load('s1')
    const p2 = r.load('s1') // 在途 → 复用同一 Promise
    resolve('url:s1')
    expect(await p1).toBe('url:s1')
    expect(await p2).toBe('url:s1')
    expect(calls).toBe(1)
  })
})

describe('createPlaybackResolver 预取', () => {
  it('prefetch 预热缓存 → 随后 load 命中、全程只取一次址', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => 0 })
    r.prefetch('s2') // 预热（in-flight）
    expect(await r.load('s2')).toBe('url:s2:1') // load 复用在途预取、不另发
    expect(r.peek('s2')).toBe('url:s2:1') // 已落缓存
    expect(fetcher.count('s2')).toBe(1) // 预取 + load 合计只取一次址
  })

  it('已有新鲜缓存时 prefetch 是 no-op', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => 0 })
    await r.load('s1')
    r.prefetch('s1')
    await Promise.resolve()
    expect(fetcher.count('s1')).toBe(1) // 没再取
  })

  it('空 segId prefetch 不取址、不崩', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher })
    expect(() => r.prefetch('')).not.toThrow()
    await Promise.resolve()
    expect(fetcher.count('')).toBe(0)
  })
})
