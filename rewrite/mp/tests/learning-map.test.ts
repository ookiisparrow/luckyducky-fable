// 黄金 learning-content §一（激活三态：新激活/本人回访/他人码/废码）+ §九（背景回退链）
// （守卫 rw-mp-learning-golden）。
import { describe, it, expect } from 'vitest'
import { activationView, bgFor, mapMyCourses, mapCatalog, mapHelpVideos, mapPublicFaq } from '../lib/mapLearning'

describe('激活结果三态 + 废码/网络失败分治（黄金 §一）', () => {
  it('大白话：新激活/本人已进课各归各屏；他人码带课程号（按课取图）；废码与未知错误一律「码不对」不冒充激活', () => {
    expect(activationView({ ok: true, state: 'activated', courseId: 'c1' })).toEqual({ kind: 'activated', courseId: 'c1' })
    expect(activationView({ ok: true, state: 'mine', courseId: 'c1' })).toEqual({ kind: 'mine', courseId: 'c1' })
    expect(activationView({ ok: false, error: 'CODE_TAKEN', courseId: 'c9' })).toEqual({ kind: 'taken', courseId: 'c9' })
    expect(activationView({ ok: false, error: 'INVALID_CODE' }).kind).toBe('invalid')
    expect(activationView({ ok: true, state: 'weird' }).kind).toBe('invalid') // 未知态 fail-closed
    expect(activationView(null).kind).toBe('invalid')
  })
  it('大白话：网络失败（CALL_FAIL/BAD_RESULT）≠废码——扫真码遇网络抖动不误告「激活码不对」，归 error 态可重试；仍 fail-closed 不冒充激活（深审20260712 P3）', () => {
    expect(activationView({ ok: false, error: 'CALL_FAIL' })).toEqual({ kind: 'error', courseId: '' })
    expect(activationView({ ok: false, error: 'BAD_RESULT' })).toEqual({ kind: 'error', courseId: '' })
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
    expect(r.continueTarget).toEqual({ segmentId: 's1', lessonId: 'l1', lessonName: '起针', resumeAt: 0 })
  })

  it('大白话：段 dur 是库内真实的 "m:ss" 字符串也能算出分钟——原 Number("5:00")=NaN 会把课时时长隐藏成 0（决策§31 批2 顺修）', () => {
    const c = {
      chapters: [
        {
          id: 'ch1',
          lessons: [{ id: 'l1', name: '起针', segments: [{ id: 's1', hasVideo: true, dur: '5:00' }, { id: 's2', hasVideo: true, dur: '1:36' }] }],
        },
      ],
    }
    const r = mapCatalog(c, [], 'c1')
    expect(r.chapters[0].lessons[0].minutes).toBe(7) // round((300+96)/60)
    expect(r.continueTarget).toEqual({ segmentId: 's1', lessonId: 'l1', lessonName: '起针', resumeAt: 0 })
  })

  it('大白话：部分 done（做完 l1）——l1 标 done、首个未完成且含可播段的课时(l2)标 current；无 last 时续播＝该课时首个可播段', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: { s1: true, s2: true }, updatedAt: 100 }], 'c1')
    const [l1, l2] = r.chapters[0].lessons
    expect(l1.status).toBe('done')
    expect(l2.status).toBe('current')
    expect(l1.firstPlayableSegId).toBe('s1') // done 课时点行仍回首个可播段
    expect(l2.firstPlayableSegId).toBe('s3')
    expect(r.continueTarget).toEqual({ segmentId: 's3', lessonId: 'l2', lessonName: '收针', resumeAt: 0 })
  })

  it('大白话：last 命中——该课时标 current 且带 lastLabel「上次学到 段落 N」，续播＝last 段', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: {}, last: { lessonId: 'l2', segmentId: 's3' }, updatedAt: 200 }], 'c1')
    const [l1] = r.chapters[0].lessons
    const [, l2] = r.chapters[0].lessons
    expect(l1.status).toBe('todo')
    expect(l2.status).toBe('current')
    expect(l2.lastLabel).toBe('上次学到 段落 1')
    expect(l2.firstPlayableSegId).toBe('s3')
    expect(r.continueTarget).toEqual({ segmentId: 's3', lessonId: 'l2', lessonName: '收针', resumeAt: 0 })
  })

  it('大白话：last 指向已删段——该课时仍标 current（lessonId 命中）但 lastLabel 空、续播回退课时内首个可播段', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: {}, last: { lessonId: 'l2', segmentId: 'sGhost' }, updatedAt: 300 }], 'c1')
    const [, l2] = r.chapters[0].lessons
    expect(l2.status).toBe('current')
    expect(l2.lastLabel).toBe('')
    expect(l2.firstPlayableSegId).toBe('s3')
    expect(r.continueTarget).toEqual({ segmentId: 's3', lessonId: 'l2', lessonName: '收针', resumeAt: 0 })
  })

  it('大白话：last 命中段仍存在但已被 admin 撤下视频（hasVideo:false）——lastLabel 仍报「上次学到」（历史事实），但 firstPlayableSegId/continueTarget 不指向不可播段、回退课时内首个 hasVideo 段', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: {}, last: { lessonId: 'l3', segmentId: 's5' }, updatedAt: 400 }], 'c1')
    const [l3] = r.chapters[1].lessons
    expect(l3.status).toBe('current')
    expect(l3.lastLabel).toBe('上次学到 段落 2') // s5 是 l3 第 2 段，历史事实不因视频撤下而抹去
    expect(l3.firstPlayableSegId).toBe('s4') // s5 无视频，回退课时内首个 hasVideo 段
    expect(r.continueTarget).toEqual({ segmentId: 's4', lessonId: 'l3', lessonName: '成品', resumeAt: 0 }) // 不落在不可播的 s5 上
  })

  it('大白话：last 命中且带播放位置 at/dur——continueTarget.resumeAt 透出 clampResumeAt(at,dur)（续播到秒·数据已在库）；兜底分支 resumeAt=0', () => {
    const r = mapCatalog(COURSE, [{ courseId: 'c1', done: {}, last: { lessonId: 'l2', segmentId: 's3', at: 40, dur: 60 }, updatedAt: 200 }], 'c1')
    expect(r.continueTarget).toEqual({ segmentId: 's3', lessonId: 'l2', lessonName: '收针', resumeAt: 40 }) // 中段·原值取整
    const r2 = mapCatalog(COURSE, [], 'c1') // 无 last 命中·续播＝首个可播段·不带秒
    expect(r2.continueTarget!.resumeAt).toBe(0)
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
    expect(r.continueTarget).toEqual({ segmentId: 's1', lessonId: 'l1', lessonName: '起针', resumeAt: 0 })
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

// 求助面板·帮助视频（P3b·播放器重设计战役批D·getHelpVideos 两级主题→小段清洗）。
describe('mapHelpVideos（帮助视频清洗·脏结构安全）', () => {
  it('大白话：正常两级——主题 title/sub/desc 与小段 name/dur/url 原样带过；url 非串归 null', () => {
    const vm = mapHelpVideos({
      items: [
        {
          id: 't1',
          title: '钩针与线材选购',
          sub: '开工前先备好家伙事',
          desc: '',
          segments: [
            { id: 's1', name: '钩针怎么选', dur: '5:40', url: 'cloud://a.mp4' },
            { id: 's2', name: '线材怎么选', dur: '3:12', url: null }, // 未剪辑段
          ],
        },
      ],
    })
    expect(vm).toHaveLength(1)
    expect(vm[0]).toEqual({
      id: 't1',
      title: '钩针与线材选购',
      sub: '开工前先备好家伙事',
      desc: '',
      segments: [
        { id: 's1', name: '钩针怎么选', dur: '5:40', url: 'cloud://a.mp4' },
        { id: 's2', name: '线材怎么选', dur: '3:12', url: null },
      ],
    })
  })

  it('大白话：脏结构安全——非数组 items/segments 归空、字段类型不对强转字符串、url 非串（数字/对象/空串）一律归 null，不崩', () => {
    expect(mapHelpVideos(null)).toEqual([])
    expect(mapHelpVideos({})).toEqual([])
    expect(mapHelpVideos({ items: '坏值' })).toEqual([])
    const vm = mapHelpVideos({
      items: [
        { id: 9, title: 88, sub: null, desc: undefined, segments: '不是数组' },
        { id: 't2', title: '主题2', segments: [{ id: 's3', name: 77, dur: 12, url: 999 }, null, '坏行'] },
      ],
    })
    // 第一条 segments 非数组归空、但仍有 title=88→'88'，不被剔除
    expect(vm[0]).toEqual({ id: '9', title: '88', sub: '', desc: '', segments: [] })
    // 第二条：脏行安全跳过/兜底，url 非串（999）归 null，name/dur 强转字符串
    expect(vm[1].segments).toEqual([
      { id: 's3', name: '77', dur: '12', url: null },
      { id: '', name: '', dur: '', url: null },
      { id: '', name: '', dur: '', url: null },
    ])
  })

  it('大白话：空——items 缺失/空数组回空数组；无 title 且无 segments 的脏主题剔除（不占空分组位）', () => {
    expect(mapHelpVideos({ items: [] })).toEqual([])
    const vm = mapHelpVideos({
      items: [
        { id: 't-ghost', title: '', segments: [] }, // 无题无段·剔除
        { id: 't-ok', title: '', segments: [{ id: 's1', name: '有段就不剔', dur: '1:00', url: 'x' }] }, // 无题但有段·保留
      ],
    })
    expect(vm).toHaveLength(1)
    expect(vm[0].id).toBe('t-ok')
  })
})

describe('mapPublicFaq（R37b·KB 精选 FAQ 公开读清洗·脏结构安全）', () => {
  it('大白话：正常——title/content 原样带过（title←question/content←answer 由云端已映射好，前端只清洗类型）', () => {
    const vm = mapPublicFaq({ items: [{ key: 'logistics:eta', title: '什么时候发货？', content: '付款后 48 小时内发货。' }] })
    expect(vm).toEqual([{ key: 'logistics:eta', title: '什么时候发货？', content: '付款后 48 小时内发货。' }])
  })

  it('大白话：脏结构安全——非数组/坏值归空、字段强转字符串、无标题的脏条目剔除（同 mapHelpVideos 剔脏档口径）', () => {
    expect(mapPublicFaq(null)).toEqual([])
    expect(mapPublicFaq({})).toEqual([])
    expect(mapPublicFaq({ items: '坏值' })).toEqual([])
    const vm = mapPublicFaq({
      items: [
        { key: 9, title: 88, content: null }, // 类型不对强转字符串，仍保留（有标题）
        { key: 'k2', title: '', content: '有内容但无标题·剔除' }, // 无标题剔除
        null,
        '坏行',
      ],
    })
    expect(vm).toEqual([{ key: '9', title: '88', content: '' }])
  })

  it('大白话：空——items 缺失/空数组回空数组', () => {
    expect(mapPublicFaq({ items: [] })).toEqual([])
  })
})
