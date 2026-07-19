// 黄金 learning-content §六（分段导航跨课时/跳过不可播/端点置灰 + 播放地址缓存 TTL/空不缓存/
// 跨课隔离/在途去重/定向失效/预取）（守卫 rw-mp-player-golden）。
import { describe, it, expect } from 'vitest'
import { flattenSegments, navSegment, createPlaybackCache, formatClock, clampSeek, lessonStrip, nearestMark } from '../lib/player'
// 源码扫描式断言（同 home-cards.test.ts 的 ?raw 范式·rewrite/mp tsconfig 无 node:fs）：续播秒/缓冲水位接线是
// wxml 绑定⟷ts 方法成对（错题本 E2），机器守卫 rw-mp-player-prefetch-cache 咬结构，这里补文本断言逼出成对。
import playerWxmlRaw from '../pages/player/player.wxml?raw'
import playerTsRaw from '../pages/player/player.ts?raw'

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

  it('大白话：peek 同步读——新鲜命中回 url、过期回空、从未取过回空，绝不触发取址（消初见切段 loading 闪烁的判据源）', async () => {
    const { cache, calls, tick } = setup(1000)
    expect(cache.peek('c1', 's1')).toBe('') // 从未取过·空
    expect(calls).toHaveLength(0) // peek 绝不取址
    const u = await cache.get('c1', 's1')
    expect(cache.peek('c1', 's1')).toBe(u) // 新鲜命中回 url
    expect(calls).toHaveLength(1) // peek 未新增真取
    tick(1001)
    expect(cache.peek('c1', 's1')).toBe('') // 过期·回空（不误当新鲜直落）
    expect(cache.peek('c1', '')).toBe('') // 空段·回空
    expect(calls).toHaveLength(1)
  })
})

describe('播放页续播秒 + 缓冲水位接线（源码扫描·wxml⟷ts 成对·E2）', () => {
  const stripWxml = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
  const stripTs = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  /** 花括号配平截出 playSegment 整个方法体（剥注释后·G2 用例共用）。 */
  const playSegmentBody = (): string => {
    const ts = stripTs(playerTsRaw)
    const start = ts.indexOf('async playSegment(')
    if (start < 0) throw new Error('未找到 playSegment 方法')
    let depth = 0
    let i = ts.indexOf('{', start)
    const bodyStart = i
    for (; i < ts.length; i++) {
      if (ts[i] === '{') depth++
      else if (ts[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    return ts.slice(bodyStart, i + 1)
  }
  it('大白话：wxml 主 video 有 initial-time 与 bind:progress；ts 定义 onVideoProgress（绑定与方法成对·抄一半真机报错）', () => {
    const wxml = stripWxml(playerWxmlRaw)
    expect(wxml).toMatch(/initial-time\s*=\s*"\{\{\s*initialTime\s*\}\}"/) // 续播秒首挂载读取
    expect(wxml).toMatch(/bind:progress\s*=\s*"onVideoProgress"/) // 缓冲水位通道
    const ts = stripTs(playerTsRaw)
    expect(ts).toMatch(/\bonVideoProgress\s*\(/) // 方法真实定义（不止绑定）
  })
  it('大白话：playSegment loading 骨架态仍含 initialTime: 0（骨架占位·<video> 未挂载不读它）', () => {
    const ts = stripTs(playerTsRaw)
    expect(ts).toMatch(/initialTime:\s*0/)
  })

  // G2：_wantAt 消费时机从「取址前无条件清零」挪到「真正把非空 src 交给挂载 video」的成功路径——
  // 首次取址/取址失败后重试，续播秒此前会被无条件消费永久丢失；裁决：peek 命中 / 取址成功且 url 非空
  // 才消费，取址异常（denied/error）与 url 为空（empty 素材未剪）都不消费，留给重试续到秒。
  it('大白话：initialTime 消费点恰好两处（peek 命中分支 + 取址成功分支），不再是无条件顶部消费', () => {
    const body = playSegmentBody()
    const consumeCount = (body.match(/if\s*\(initialTime\s*>\s*0\)\s*this\._wantAt\s*=\s*0/g) || []).length
    expect(consumeCount).toBe(2) // 唯二消费点：peek 命中 + 取址成功
  })

  it('大白话：peek 命中分支内消费（消费点落在 if (peeked) 到该分支 return 之间）', () => {
    const body = playSegmentBody()
    const peekedIdx = body.indexOf('if (peeked) {')
    expect(peekedIdx).toBeGreaterThan(-1)
    const peekedReturnIdx = body.indexOf('return', peekedIdx)
    const consumeIdx = body.indexOf('this._wantAt = 0', peekedIdx)
    expect(consumeIdx).toBeGreaterThan(peekedIdx)
    expect(consumeIdx).toBeLessThan(peekedReturnIdx)
  })

  it('大白话：失败分支（NOT_ENTITLED→denied / 取址异常→error / url 为空→empty）都不消费 _wantAt——留给重试续到秒', () => {
    const body = playSegmentBody()
    const catchIdx = body.indexOf('catch (e)')
    const emptyIdx = body.indexOf("state: 'empty'")
    expect(catchIdx).toBeGreaterThan(-1)
    expect(emptyIdx).toBeGreaterThan(-1)
    // catch 块（denied/error 两态）范围：从 catch (e) 到 empty 分支之前（两块紧邻·顺序 catch→url 判空）
    expect(body.slice(catchIdx, emptyIdx)).not.toContain('_wantAt = 0')
    // empty 分支：从 state:'empty' 到该分支 return
    const emptyReturnIdx = body.indexOf('return', emptyIdx)
    expect(body.slice(emptyIdx, emptyReturnIdx)).not.toContain('_wantAt = 0')
  })
})

describe('竖屏沉浸播放页·进度条纯函数（批：帮助入口）', () => {
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
