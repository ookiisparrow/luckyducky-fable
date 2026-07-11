// 黄金 learning-content §六（分段导航跨课时/跳过不可播/端点置灰 + 播放地址缓存 TTL/空不缓存/
// 跨课隔离/在途去重/定向失效/预取）（守卫 rw-mp-player-golden）。
import { describe, it, expect } from 'vitest'
import { flattenSegments, navSegment, createPlaybackCache, formatClock, clampSeek, lessonStrip, nearestMark, playbackModeFor, rotateSwapPlan } from '../lib/player'

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

describe('播放地址缓存 mode 维（R40 投屏批2：portrait/landscape 独立缓存）', () => {
  const setupMode = () => {
    const calls: string[] = []
    const cache = createPlaybackCache({
      fetcher: async (c, s, mode) => {
        calls.push(c + '/' + s + '/' + mode)
        return 'https://v/' + c + '/' + s + '/' + mode + '?n=' + calls.length
      },
    })
    return { cache, calls }
  }

  it('大白话：同段双 mode 各自缓存互不污染——各自命中不重取，两者地址不同', async () => {
    const { cache, calls } = setupMode()
    const p = await cache.get('c1', 's1', 'portrait')
    const l = await cache.get('c1', 's1', 'landscape')
    expect(p).not.toBe(l)
    expect(await cache.get('c1', 's1', 'portrait')).toBe(p) // 命中 portrait 缓存
    expect(await cache.get('c1', 's1', 'landscape')).toBe(l) // 命中 landscape 缓存
    expect(calls).toHaveLength(2) // 各自只真取一次
  })

  it('大白话：invalidate 一次清 portrait+landscape 两个键', async () => {
    const { cache, calls } = setupMode()
    await cache.get('c1', 's1', 'portrait')
    await cache.get('c1', 's1', 'landscape')
    expect(calls).toHaveLength(2)
    cache.invalidate('c1', 's1')
    await cache.get('c1', 's1', 'portrait')
    await cache.get('c1', 's1', 'landscape')
    expect(calls).toHaveLength(4) // 两个 mode 都被清、都重取
  })

  it('大白话：get 缺省 mode 参数=portrait——向后兼容旧调用点（不传 mode 命中同一份 portrait 缓存）', async () => {
    const { cache, calls } = setupMode()
    const noMode = await cache.get('c1', 's1')
    const explicitPortrait = await cache.get('c1', 's1', 'portrait')
    expect(noMode).toBe(explicitPortrait)
    expect(calls).toHaveLength(1) // 只真取一次
  })
})

describe('playbackModeFor（投屏播放模式判定·R40 纯函数）', () => {
  it('大白话：无段/无 hasLandscape/不想要横屏一律 portrait；段齐备+想要横屏才给 landscape', () => {
    expect(playbackModeFor(null, true)).toBe('portrait') // 无段
    expect(playbackModeFor({ hasLandscape: false }, true)).toBe('portrait') // 无 hasLandscape
    expect(playbackModeFor({ hasLandscape: true }, false)).toBe('portrait') // 不想要横屏
    expect(playbackModeFor({ hasLandscape: true }, true)).toBe('landscape') // 齐备
  })
})

describe('rotateSwapPlan（手机横屏播放换源方案判定·R41 纯函数，批3）', () => {
  it('大白话：投屏 connected 态电视持有源，旋转手机不换源', () => {
    expect(rotateSwapPlan({ hasLandscape: true }, true, true)).toBeNull()
  })
  it('大白话：无当前段（尚未进入播放）不产生换源动作', () => {
    expect(rotateSwapPlan(null, true, false)).toBeNull()
  })
  it('大白话：转横屏且该段确有横屏源→landscape', () => {
    expect(rotateSwapPlan({ hasLandscape: true }, true, false)).toBe('landscape')
  })
  it('大白话：转横屏但该段无横屏源→安全降级 portrait（swapSource 对同 url 天然 no-op）', () => {
    expect(rotateSwapPlan({ hasLandscape: false }, true, false)).toBe('portrait')
  })
})

describe('竖屏沉浸播放页·进度条纯函数（批：一键投屏 + 帮助入口）', () => {
  it('大白话：formatClock 秒转 m:ss，负数/非数字/超一分钟都算对', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
    expect(formatClock(-3)).toBe('0:00') // 脏值不裂显示
    expect(formatClock(NaN)).toBe('0:00')
  })

  it('大白话：clampSeek 把拖动/脏值夹进 [0, durSec]，不跳出可播范围', () => {
    expect(clampSeek(30, 120)).toBe(30)
    expect(clampSeek(-5, 120)).toBe(0) // 下界
    expect(clampSeek(200, 120)).toBe(120) // 上界
    expect(clampSeek(30.9, 120)).toBe(30) // 取整
    expect(clampSeek(30, 0)).toBe(30) // 总时长未知(0)时不误夹为 0
    expect(clampSeek(NaN, 120)).toBe(0)
  })
})

describe('关键动作节点 marks 透传清洗（设计拍板⑤·前端宽松读）', () => {
  const COURSE_MARKS = {
    id: 'c1',
    chapters: [
      {
        id: 'ch1',
        title: '第一章',
        lessons: [
          {
            id: 'l1',
            name: '起针',
            segments: [
              { id: 's1', name: '一', hasVideo: true, marks: [{ at: 30, name: 'B' }, { at: -5, name: 'bad' }, 'x', { at: 10.9, name: 'A' }, {}] },
              { id: 's2', name: '二', hasVideo: true }, // 无 marks 字段
            ],
          },
        ],
      },
    ],
  }
  it('大白话：脏 marks（非数组/负 at/缺 name/乱序）清洗剔除+取整+按 at 升序；无 marks 字段的段回 []', () => {
    const flat = flattenSegments(COURSE_MARKS)
    expect(flat.find((f) => f.segmentId === 's1')!.marks).toEqual([
      { at: 10, name: 'A' },
      { at: 30, name: 'B' },
    ])
    expect(flat.find((f) => f.segmentId === 's2')!.marks).toEqual([])
  })
})

describe('flattenSegments hasLandscape 透传（R40 投屏批2·前端宽松读）', () => {
  const COURSE_LANDSCAPE = {
    id: 'c1',
    chapters: [
      {
        id: 'ch1',
        title: '第一章',
        lessons: [
          {
            id: 'l1',
            name: '起针',
            segments: [
              { id: 's1', name: '一', hasVideo: true, hasLandscape: true },
              { id: 's2', name: '二', hasVideo: true }, // 缺字段
            ],
          },
        ],
      },
    ],
  }
  it('大白话：hasLandscape 透传为必备布尔字段；缺字段宽松读为 false', () => {
    const flat = flattenSegments(COURSE_LANDSCAPE)
    expect(flat.find((f) => f.segmentId === 's1')!.hasLandscape).toBe(true)
    expect(flat.find((f) => f.segmentId === 's2')!.hasLandscape).toBe(false)
  })
})

describe('lessonStrip（课时内分段条映射·P1/P4 segstrip 数据源）', () => {
  const COURSE = {
    id: 'c1',
    chapters: [
      {
        id: 'ch1',
        title: '第一章',
        lessons: [
          { id: 'l1', name: '起针', segments: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
          { id: 'l2', name: '收针', segments: [{ id: 's4' }, { id: 's5' }] },
        ],
      },
      {
        id: 'ch2',
        title: '第二章',
        lessons: [{ id: 'l3', name: '收尾', segments: [{ id: 's6' }] }],
      },
    ],
  }
  it('大白话：跨章课时序号连续——第二章第 1 个课时序号接着第一章两个课时往下数', () => {
    expect(lessonStrip(COURSE, 's6')!.lessonNo).toBe('03')
    expect(lessonStrip(COURSE, 's1')!.lessonNo).toBe('01')
    expect(lessonStrip(COURSE, 's4')!.lessonNo).toBe('02')
  })
  it('大白话：播放中（completed 缺省）——当前段之前 done、当前段 cur、之后 todo，按位置序诚实近似', () => {
    const s = lessonStrip(COURSE, 's5')!
    expect(s.chapterTitle).toBe('第一章')
    expect(s.lessonName).toBe('收针')
    expect(s.segIndex).toBe(2)
    expect(s.segTotal).toBe(2)
    expect(s.cells).toEqual(['done', 'cur'])
  })
  it('大白话：段落播完态（completed=true）——当前段转 done，紧随其后一段转 cur，其余不变', () => {
    const s = lessonStrip(COURSE, 's2', true)!
    expect(s.segIndex).toBe(2)
    expect(s.cells).toEqual(['done', 'done', 'cur']) // s1 之前=done·s2 当前转 done·s3 紧随其后=cur
  })
  it('大白话：当前段是课时末段时 completed=true 无 cur 格（没有紧随其后一段）', () => {
    const s = lessonStrip(COURSE, 's3', true)!
    expect(s.cells).toEqual(['done', 'done', 'done'])
  })
  it('大白话：找不到当前段 → null；脏 course 不崩', () => {
    expect(lessonStrip(COURSE, 'ghost')).toBeNull()
    expect(lessonStrip(null, 's1')).toBeNull()
    expect(lessonStrip({ chapters: [{ lessons: null }, null] }, 's1')).toBeNull()
  })
})

describe('nearestMark（磁吸判定·拖动·纯函数）', () => {
  const MARKS = [
    { at: 10, name: 'A' },
    { at: 20, name: 'B' },
    { at: 30, name: 'C' },
  ]
  it('大白话：命中窗口内最近者；等距取 at 较小者；窗口外/空表/windowSec 非正数一律 null', () => {
    expect(nearestMark(12, MARKS, 5)).toEqual({ at: 10, name: 'A' })
    expect(nearestMark(15, MARKS, 5)).toEqual({ at: 10, name: 'A' }) // 等距 10/20 → 取小
    expect(nearestMark(24, MARKS, 5)).toEqual({ at: 20, name: 'B' })
    expect(nearestMark(100, MARKS, 5)).toBeNull() // 窗口外
    expect(nearestMark(10, [], 5)).toBeNull() // 空表
    expect(nearestMark(10, MARKS, 0)).toBeNull() // windowSec 非正数
    expect(nearestMark(10, MARKS, -1)).toBeNull()
  })
})
