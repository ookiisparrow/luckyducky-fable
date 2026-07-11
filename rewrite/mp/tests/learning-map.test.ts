// 黄金 learning-content §一（激活三态：新激活/本人回访/他人码/废码）+ §九（背景回退链）
// （守卫 rw-mp-learning-golden）。
import { describe, it, expect } from 'vitest'
import { activationView, bgFor, mapMyCourses, mapCatalog } from '../lib/mapLearning'

describe('激活结果三态 + 废码兜底（黄金 §一）', () => {
  it('大白话：新激活/本人已进课各归各屏；他人码带课程号（按课取图）；废码与未知错误一律「码不对」不冒充激活', () => {
    expect(activationView({ ok: true, state: 'activated', courseId: 'c1' })).toEqual({ kind: 'activated', courseId: 'c1' })
    expect(activationView({ ok: true, state: 'mine', courseId: 'c1' })).toEqual({ kind: 'mine', courseId: 'c1' })
    expect(activationView({ ok: false, error: 'CODE_TAKEN', courseId: 'c9' })).toEqual({ kind: 'taken', courseId: 'c9' })
    expect(activationView({ ok: false, error: 'INVALID_CODE' }).kind).toBe('invalid')
    expect(activationView({ ok: false, error: 'CALL_FAIL' }).kind).toBe('invalid') // 网络失败不冒充
    expect(activationView({ ok: true, state: 'weird' }).kind).toBe('invalid') // 未知态 fail-closed
    expect(activationView(null).kind).toBe('invalid')
  })
})

describe('激活屏背景回退链（黄金 §九：缺哪级回退哪级）', () => {
  const HOME = {
    activationBg: 'cloud://global.jpg',
    activationBgByCourse: { c1: { welcome: 'cloud://c1-w.jpg', welcomeBack: 'cloud://c1-wb.jpg', taken: 'cloud://c1-t.jpg' } },
  }
  it('大白话：按课程有图用课程图（三态各取各图）；该课没配回退全局图；全局也没配回空串落纯色底', () => {
    expect(bgFor(HOME, 'c1', 'activated')).toBe('cloud://c1-w.jpg')
    expect(bgFor(HOME, 'c1', 'mine')).toBe('cloud://c1-wb.jpg')
    expect(bgFor(HOME, 'c1', 'taken')).toBe('cloud://c1-t.jpg')
    expect(bgFor(HOME, 'c-nobg', 'activated')).toBe('cloud://global.jpg') // 该课没配→全局
    expect(bgFor({ activationBgByCourse: {} }, 'c1', 'activated')).toBe('') // 全没配→空串不裂图
    expect(bgFor(null, 'c1', 'activated')).toBe('') // 内容拿不到也安全
  })
})

describe('我的课程 join（标题缺失不崩）', () => {
  it('大白话：join 出课程标题；库里没这门课的档就先显示课程号（不空行不崩）；脏行剔除', () => {
    const vm = mapMyCourses(
      [
        { courseId: 'c1', enteredAt: 1783046400000 },
        { courseId: 'c-ghost', enteredAt: 1783046400000 }, // 课程档缺失
        { enteredAt: 1 }, // 脏行
      ],
      [{ id: 'c1', title: '钩织入门·小棉鸭' }]
    )
    expect(vm).toHaveLength(2)
    expect(vm[0].title).toBe('钩织入门·小棉鸭')
    expect(vm[1].title).toBe('c-ghost') // 回退课程号
    expect(vm[0].enteredAtLabel).toMatch(/^\d{4}-/)
    expect(mapMyCourses(undefined, undefined)).toEqual([]) // 非数组安全
  })
})

// C 类竖切（2026-07-07）：我的课程学习进度（段粒度·与后台 customer360 provider 同口径·纯前端组合三 action）。
describe('我的课程学习进度（段粒度·交集防 stale·不除零·守卫 rw-mp-learning-golden）', () => {
  const COURSES = [
    {
      id: 'c1',
      title: '钩织入门',
      chapters: [
        {
          id: 'ch1',
          lessons: [
            { id: 'l1', segments: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
            { id: 'l2', segments: [{ id: 's4' }, { id: 's5' }] },
          ],
        },
      ],
    },
  ]
  it('大白话：总集数=课内所有段之和；已学=done 命中的段数；百分比四舍五入', () => {
    const vm = mapMyCourses([{ courseId: 'c1', enteredAt: 1783046400000 }], COURSES, [{ courseId: 'c1', done: { s1: true, s2: true } }])
    expect(vm[0].totalSegments).toBe(5)
    expect(vm[0].doneCount).toBe(2)
    expect(vm[0].percent).toBe(40) // 2/5
  })
  it('大白话：done 里混入不属于该课的 stale segmentId 不计入（分子不超分母·percent≤100）', () => {
    const vm = mapMyCourses(
      [{ courseId: 'c1', enteredAt: 1 }],
      COURSES,
      [{ courseId: 'c1', done: { s1: true, s2: true, s3: true, s4: true, s5: true, sGhost: true, sDeleted: true } }]
    )
    expect(vm[0].doneCount).toBe(5) // sGhost/sDeleted 不在该课段集·剔除
    expect(vm[0].totalSegments).toBe(5)
    expect(vm[0].percent).toBe(100) // 不超 100
  })
  it('大白话：无 progress 文档→0/N·percent 0；空课(0 段)→percent 0 不除零·不崩', () => {
    const vm = mapMyCourses([{ courseId: 'c1', enteredAt: 1 }], COURSES, [])
    expect(vm[0].doneCount).toBe(0)
    expect(vm[0].percent).toBe(0)
    const empty = mapMyCourses([{ courseId: 'cx', enteredAt: 1 }], [{ id: 'cx', title: '空课' }], [])
    expect(empty[0].totalSegments).toBe(0)
    expect(empty[0].percent).toBe(0)
  })
  it('大白话：progress/courses/done 传脏值不崩·安全空', () => {
    expect(() => mapMyCourses([{ courseId: 'c1', enteredAt: 1 }], null, null)).not.toThrow()
    expect(() => mapMyCourses([{ courseId: 'c1', enteredAt: 1 }], COURSES, '坏')).not.toThrow()
    const vm = mapMyCourses([{ courseId: 'c1', enteredAt: 1 }], COURSES, [{ courseId: 'c1', done: null }])
    expect(vm[0].doneCount).toBe(0) // done 非对象→0
  })
})

// C1 目录页数据源（教学播放重设计批A·2026-07-11 预审裁决消歧优先级）。
describe('mapCatalog（目录页数据源·课时状态/续播/磁贴 VM）', () => {
  const COURSE = {
    id: 'c1',
    chapters: [
      {
        id: 'ch1',
        title: '第一章',
        lessons: [
          { id: 'l1', name: '起针', segments: [{ id: 's1', hasVideo: true, dur: 90 }, { id: 's2', hasVideo: true, dur: 150 }] },
          { id: 'l2', name: '收针', segments: [{ id: 's3', hasVideo: true, dur: 60 }] },
        ],
      },
      {
        id: 'ch2',
        title: '第二章',
        lessons: [{ id: 'l3', name: '成品', segments: [{ id: 's4', hasVideo: true, dur: 200 }, { id: 's5', hasVideo: false }] }],
      },
    ],
  }

  it('大白话：无进度——全 todo，首个含可播段的课时为 current；no 跨章连续；minutes 按 dur 求和取整', () => {
    const r = mapCatalog(COURSE, [], 'c1')
    expect(r.chapters).toHaveLength(2)
    const [l1, l2] = r.chapters[0].lessons
    const [l3] = r.chapters[1].lessons
    expect(l1.status).toBe('current')
    expect(l2.status).toBe('todo')
    expect(l3.status).toBe('todo')
    expect(l1.no).toBe('01')
    expect(l2.no).toBe('02')
    expect(l3.no).toBe('03') // 跨章连续
    expect(l1.minutes).toBe(4) // round((90+150)/60)
    expect(l2.minutes).toBe(1)
    expect(l3.minutes).toBe(3) // round(200/60)
    expect(l1.lastLabel).toBe('')
    expect(l1.firstPlayableSegId).toBe('s1')
    expect(l3.firstPlayableSegId).toBe('s4') // s5 无视频跳过
    expect(r.continueTarget).toEqual({ segmentId: 's1', lessonId: 'l1', lessonName: '起针' })
  })

  it('大白话：部分 done（做完 l1）——l1 标 done、首个未完成且含可播段的课时(l2)标 current；无 last 时续播＝该课时首个可播段', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: { s1: true, s2: true }, updatedAt: 100 }], 'c1')
    const [l1, l2] = r.chapters[0].lessons
    expect(l1.status).toBe('done')
    expect(l2.status).toBe('current')
    expect(l1.firstPlayableSegId).toBe('s1') // done 课时点行仍回首个可播段
    expect(l2.firstPlayableSegId).toBe('s3')
    expect(r.continueTarget).toEqual({ segmentId: 's3', lessonId: 'l2', lessonName: '收针' })
  })

  it('大白话：last 命中——该课时标 current 且带 lastLabel「上次学到 段落 N」，续播＝last 段', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: {}, last: { lessonId: 'l2', segmentId: 's3' }, updatedAt: 200 }], 'c1')
    const [l1] = r.chapters[0].lessons
    const [, l2] = r.chapters[0].lessons
    expect(l1.status).toBe('todo')
    expect(l2.status).toBe('current')
    expect(l2.lastLabel).toBe('上次学到 段落 1')
    expect(l2.firstPlayableSegId).toBe('s3')
    expect(r.continueTarget).toEqual({ segmentId: 's3', lessonId: 'l2', lessonName: '收针' })
  })

  it('大白话：last 指向已删段——该课时仍标 current（lessonId 命中）但 lastLabel 空、续播回退课时内首个可播段', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: {}, last: { lessonId: 'l2', segmentId: 'sGhost' }, updatedAt: 300 }], 'c1')
    const [, l2] = r.chapters[0].lessons
    expect(l2.status).toBe('current')
    expect(l2.lastLabel).toBe('')
    expect(l2.firstPlayableSegId).toBe('s3')
    expect(r.continueTarget).toEqual({ segmentId: 's3', lessonId: 'l2', lessonName: '收针' })
  })

  it('大白话：last 命中段仍存在但已被 admin 撤下视频（hasVideo:false）——lastLabel 仍报「上次学到」（历史事实），但 firstPlayableSegId/continueTarget 不指向不可播段、回退课时内首个 hasVideo 段', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: {}, last: { lessonId: 'l3', segmentId: 's5' }, updatedAt: 400 }], 'c1')
    const [l3] = r.chapters[1].lessons
    expect(l3.status).toBe('current')
    expect(l3.lastLabel).toBe('上次学到 段落 2') // s5 是 l3 第 2 段，历史事实不因视频撤下而抹去
    expect(l3.firstPlayableSegId).toBe('s4') // s5 无视频，回退课时内首个 hasVideo 段
    expect(r.continueTarget).toEqual({ segmentId: 's4', lessonId: 'l3', lessonName: '成品' }) // 不落在不可播的 s5 上
  })

  it('大白话：stale done 键（不属于本课的段 id）不顶爆课时 done 判定，被安全忽略', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: { s1: true, s2: true, s3: true, sGhostDone: true }, updatedAt: 50 }], 'c1')
    const [l1, l2] = r.chapters[0].lessons
    const [l3] = r.chapters[1].lessons
    expect(l1.status).toBe('done')
    expect(l2.status).toBe('done')
    expect(l3.status).toBe('current') // 唯一未完成且含可播段的课时
  })

  it('大白话：全完成态——全部课时标 done、无 current、lastLabel 全空；但 last 命中时 continueTarget 仍回上次位置（重温）', () => {
    const r = mapCatalog(
      COURSE,
      [{ courseId: 'c1', done: { s1: true, s2: true, s3: true, s4: true, s5: true }, last: { lessonId: 'l1', segmentId: 's1' }, updatedAt: 999 }],
      'c1'
    )
    for (const ch of r.chapters) for (const l of ch.lessons) {
      expect(l.status).toBe('done')
      expect(l.lastLabel).toBe('')
    }
    expect(r.continueTarget).toEqual({ segmentId: 's1', lessonId: 'l1', lessonName: '起针' })
  })

  it('大白话：脏 course/progressList 不崩，安全空', () => {
    expect(mapCatalog(null, [], 'c1')).toEqual({ chapters: [], continueTarget: null })
    expect(() => mapCatalog(COURSE, '坏值', 'c1')).not.toThrow()
    expect(() => mapCatalog(COURSE, null, 'c1')).not.toThrow()
    expect(() => mapCatalog({ chapters: [{ lessons: null }, null] }, [], 'c1')).not.toThrow()
    const r = mapCatalog(COURSE, '坏值', 'c1')
    expect(r.chapters[0].lessons[0].status).toBe('current') // 脏 progressList 等同无进度
  })
})
