// 黄金 learning-content §六（分段导航跨课时/跳过不可播/端点置灰 + 播放地址缓存 TTL/空不缓存/
// 跨课隔离/在途去重/定向失效/预取）（守卫 rw-mp-player-golden）。
import { describe, it, expect } from 'vitest'
import { flattenSegments, navSegment, createPlaybackCache } from '../lib/player'

const COURSE = {
  id: 'c1',
  title: '钩织入门',
  chapters: [
    {
      id: 'ch1',
      title: '第一章',
      lessons: [
        { id: 'l1', name: '起针', segments: [{ id: 's1', name: '一', hasVideo: true }, { id: 's2', name: '二', hasVideo: true }] },
        { id: 'l2', name: '半上线课时', segments: [{ id: 's3', name: '无视频', hasVideo: false }] },
      ],
    },
    {
      id: 'ch2',
      title: '第二章',
      lessons: [{ id: 'l3', name: '收尾', segments: [{ id: 's4', name: '四', hasVideo: true }] }],
    },
  ],
}

describe('分段导航（黄金 §六）', () => {
  it('大白话：课时内前后切；末段下一段自动接下一课时；无视频课时被跳过不困死控件；全课端点/脏输入回空置灰', () => {
    expect(navSegment(COURSE, 's1', 1)!.segmentId).toBe('s2') // 课时内
    expect(navSegment(COURSE, 's2', 1)!.segmentId).toBe('s4') // 跨课时且跳过无视频的 l2
    expect(navSegment(COURSE, 's4', -1)!.segmentId).toBe('s2') // 反向同样跳过
    expect(navSegment(COURSE, 's4', 1)).toBeNull() // 全课末段·置灰
    expect(navSegment(COURSE, 's1', -1)).toBeNull() // 全课首段·置灰
    expect(navSegment(COURSE, 'ghost', 1)).toBeNull() // 找不到当前段
    expect(navSegment(COURSE, 's1', 0)).toBeNull() // 步长 0
    expect(navSegment(null, 's1', 1)).toBeNull() // 脏课程
    expect(flattenSegments({ chapters: [{ lessons: null }, null] })).toEqual([]) // 缺层安全
  })
})

describe('播放地址缓存（黄金 §六）', () => {
  const setup = (ttlMs = 1000) => {
    let t = 0
    const calls: string[] = []
    const urls: Record<string, string> = {}
    const cache = createPlaybackCache({
      fetcher: async (c, s) => {
        calls.push(c + '/' + s)
        return urls[c + '/' + s] ?? 'https://v/' + c + '/' + s + '?n=' + calls.length
      },
      now: () => t,
      ttlMs,
    })
    return { cache, calls, urls, tick: (ms: number) => (t += ms) }
  }

  it('大白话：有效期内同段命中不重取；过期重新取址；空结果不缓存下次仍重试；空段不取址', async () => {
    const { cache, calls, urls, tick } = setup(1000)
    const u1 = await cache.get('c1', 's1')
    expect(await cache.get('c1', 's1')).toBe(u1) // 命中
    expect(calls).toHaveLength(1)
    tick(1001)
    await cache.get('c1', 's1') // 过期重取
    expect(calls).toHaveLength(2)
    // 空结果不缓存（素材未剪·下次重试）
    urls['c1/s-empty'] = ''
    expect(await cache.get('c1', 's-empty')).toBe('')
    await cache.get('c1', 's-empty')
    expect(calls.filter((c) => c === 'c1/s-empty')).toHaveLength(2)
    expect(await cache.get('c1', '')).toBe('') // 空段不取址
    expect(calls.filter((c) => c.endsWith('/'))).toHaveLength(0)
  })

  it('大白话：跨课隔离（缓存键含课程号）；并发取同段只真取一次；定向失效只清本段不误伤', async () => {
    const { cache, calls } = setup(60_000)
    const a = await cache.get('c1', 'sx')
    const b = await cache.get('c2', 'sx') // 同名段不同课·各取各的
    expect(a).not.toBe(b)
    expect(calls).toHaveLength(2)
    // 在途去重
    const [p1, p2] = await Promise.all([cache.get('c3', 's9'), cache.get('c3', 's9')])
    expect(p1).toBe(p2)
    expect(calls.filter((c) => c === 'c3/s9')).toHaveLength(1)
    // 定向失效
    cache.invalidate('c1', 'sx')
    await cache.get('c1', 'sx')
    await cache.get('c2', 'sx')
    expect(calls.filter((c) => c === 'c1/sx')).toHaveLength(2) // c1 重取
    expect(calls.filter((c) => c === 'c2/sx')).toHaveLength(1) // c2 不误伤
  })

  it('大白话：预取预热缓存随后取用零重复；已新鲜时预取是空操作；空段预取不崩', async () => {
    const { cache, calls } = setup(60_000)
    await cache.prefetch('c1', 's1')
    await cache.get('c1', 's1')
    expect(calls.filter((c) => c === 'c1/s1')).toHaveLength(1) // 预热后取用命中
    await cache.prefetch('c1', 's1') // 已新鲜·空操作
    expect(calls.filter((c) => c === 'c1/s1')).toHaveLength(1)
    await cache.prefetch('c1', '') // 不崩
  })
})
