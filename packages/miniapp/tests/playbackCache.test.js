import { describe, it, expect } from 'vitest'
import { createPlaybackResolver } from '@/utils/playbackCache.js'

// 分段视频播放地址解析器：缓存（按 (courseId,segId)+TTL）+ 预取 + in-flight 去重 + 失效（治真机段间
// 转场卡顿·根因#8）。纯函数工厂，fetcher/now 注入 → 缓存命中/过期/去重/预取/跨课隔离/失效边界可单测。

// 计数 fetcher：每次调用 +1，返回该 (课,段) 的「第 N 版」URL（验证有没有重复取址 + 课/段是否正确流入）
function counting() {
  const calls = {}
  const fn = (courseId, segId) => {
    const k = `${courseId}:${segId}`
    calls[k] = (calls[k] || 0) + 1
    return Promise.resolve(`url:${courseId}:${segId}:${calls[k]}`)
  }
  fn.count = (courseId, segId) => calls[`${courseId}:${segId}`] || 0
  return fn
}

describe('createPlaybackResolver 缓存', () => {
  it('TTL 内第二次 load 命中缓存、不再取址', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => 0 })
    expect(await r.load('cA', 's1')).toBe('url:cA:s1:1')
    expect(await r.load('cA', 's1')).toBe('url:cA:s1:1') // 同一版本=没重取
    expect(fetcher.count('cA', 's1')).toBe(1)
  })

  it('过期后 load 重新取址', async () => {
    const fetcher = counting()
    let t = 0
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => t })
    expect(await r.load('cA', 's1')).toBe('url:cA:s1:1')
    t = 1500 // 越过 TTL
    expect(await r.load('cA', 's1')).toBe('url:cA:s1:2') // 第二版=重取了
    expect(fetcher.count('cA', 's1')).toBe(2)
  })

  it('空 segId → 空串、不取址', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher })
    expect(await r.load('cA', '')).toBe('')
    expect(fetcher.count('cA', '')).toBe(0)
  })

  it('取址返回空（素材未剪/未授权）不缓存，下次仍重试', async () => {
    let n = 0
    const fetcher = (courseId, segId) => Promise.resolve(n++ === 0 ? '' : `url:${courseId}:${segId}`)
    const r = createPlaybackResolver({ fetcher, now: () => 0 })
    expect(await r.load('cA', 's1')).toBe('') // 首次空
    expect(await r.load('cA', 's1')).toBe('url:cA:s1') // 没被缓存为空 → 重试拿到真地址
  })
})

describe('createPlaybackResolver 跨课隔离（审计 #1：键含 courseId）', () => {
  it('两课相同 segId 不串味、各缓存各的地址', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => 0 })
    // 两门课都有段 'l1-s1'（种子段 id 课内局部命名·跨课会撞）
    expect(await r.load('duck', 'l1-s1')).toBe('url:duck:l1-s1:1')
    expect(await r.load('bear', 'l1-s1')).toBe('url:bear:l1-s1:1') // 不命中 duck 的缓存
    expect(fetcher.count('duck', 'l1-s1')).toBe(1)
    expect(fetcher.count('bear', 'l1-s1')).toBe(1)
    // 各自再 load 仍命中自己那条
    expect(await r.load('duck', 'l1-s1')).toBe('url:duck:l1-s1:1')
    expect(await r.load('bear', 'l1-s1')).toBe('url:bear:l1-s1:1')
    expect(fetcher.count('duck', 'l1-s1')).toBe(1)
  })
})

describe('createPlaybackResolver in-flight 去重', () => {
  it('并发 load 同 (课,段) 只取一次址', async () => {
    let calls = 0
    let resolve
    const fetcher = () => {
      calls++
      return new Promise((res) => (resolve = res))
    }
    const r = createPlaybackResolver({ fetcher, now: () => 0 })
    const p1 = r.load('cA', 's1')
    const p2 = r.load('cA', 's1') // 在途 → 复用同一 Promise
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
    r.prefetch('cA', 's2') // 预热（in-flight）
    expect(await r.load('cA', 's2')).toBe('url:cA:s2:1') // load 复用在途预取、不另发
    expect(r.peek('cA', 's2')).toBe('url:cA:s2:1') // 已落缓存
    expect(fetcher.count('cA', 's2')).toBe(1) // 预取 + load 合计只取一次址
  })

  it('已有新鲜缓存时 prefetch 是 no-op', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => 0 })
    await r.load('cA', 's1')
    r.prefetch('cA', 's1')
    await Promise.resolve()
    expect(fetcher.count('cA', 's1')).toBe(1) // 没再取
  })

  it('空 segId prefetch 不取址、不崩', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher })
    expect(() => r.prefetch('cA', '')).not.toThrow()
    await Promise.resolve()
    expect(fetcher.count('cA', '')).toBe(0)
  })
})

describe('createPlaybackResolver 失效（审计 #2：retry 真重取）', () => {
  it('invalidate 后 load 重新取址、不命中旧（已失效）URL', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => 0 })
    expect(await r.load('cA', 's1')).toBe('url:cA:s1:1')
    r.invalidate('cA', 's1') // 失效本段（模拟服务端 URL 已坏·本地 TTL 内仍「新鲜」）
    expect(r.peek('cA', 's1')).toBeNull() // 缓存已清
    expect(await r.load('cA', 's1')).toBe('url:cA:s1:2') // 第二版=真重取了新地址
    expect(fetcher.count('cA', 's1')).toBe(2)
  })

  it('invalidate 只清本 (课,段)、不误伤别课同段', async () => {
    const fetcher = counting()
    const r = createPlaybackResolver({ fetcher, ttlMs: 1000, now: () => 0 })
    await r.load('duck', 'l1-s1')
    await r.load('bear', 'l1-s1')
    r.invalidate('duck', 'l1-s1')
    expect(r.peek('duck', 'l1-s1')).toBeNull()
    expect(r.peek('bear', 'l1-s1')).toBe('url:bear:l1-s1:1') // 别课同段仍在
  })
})
