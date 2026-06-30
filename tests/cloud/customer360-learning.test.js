import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { getCustomer360 } from '../../packages/cloud/src/functions/admin/adminApi/actions/customer360'

// 后台360工作站 B2.1：学习位置 provider（铁律三）——progress.last join courses 人话化（章/节/段/完成度）。
const db = cloud.database()
const ctx = (data) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)
const learningOf = (r) => r.panels.find((p) => p.key === 'learning')

// 三层课程样本（chapter→lesson→segment）·共 5 段（l1:2 + l2:2 + l3:1）
const COURSE = {
  _id: 'course-duck',
  id: 'course-duck',
  title: '零基础 · 钩织你的第一只小棉鸭',
  sort: 0,
  chapters: [
    {
      id: 'c1',
      title: '开始之前 · 备好工具',
      lessons: [
        { id: 'l1', name: '认识钩织工具包', dur: '03:20', segments: [{ id: 'l1-s1', name: '先看成品长啥样' }, { id: 'l1-s2', name: '需要的材料工具' }] },
        { id: 'l2', name: '毛线与钩针怎么挑', dur: '04:05', segments: [{ id: 'l2-s1', name: '选线' }, { id: 'l2-s2', name: '选针' }] },
      ],
    },
    {
      id: 'c2',
      title: '基础针法 · 一看就会',
      lessons: [{ id: 'l3', name: '锁针：花样的地基', dur: '04:48', segments: [{ id: 'l3-s1', name: '起针' }] }],
    },
  ],
}

beforeEach(() => control.reset())

describe('学习位置 provider（B2.1·铁律三·人话化章/节/段/完成度）', () => {
  it('progress.last join courses → 人话化位置 + 完成度（只本人）', async () => {
    control.seed('courses', [COURSE])
    control.seed('progress', [
      {
        _id: 'A__course-duck',
        _openid: 'A',
        courseId: 'course-duck',
        done: { 'l1-s1': true, 'l1-s2': true, 'l2-s1': true }, // 完成 3/5
        last: { lessonId: 'l2', segmentId: 'l2-s2', at: 42, dur: 200 },
        updatedAt: 9000,
      },
      { _id: 'B__course-duck', _openid: 'B', courseId: 'course-duck', done: {}, last: {} }, // 别人的·不该出现
    ])
    const learning = learningOf(parse(await getCustomer360(ctx({ openid: 'A' }))))
    expect(learning.label).toBe('学习位置')
    expect(learning.error).toBeUndefined()
    expect(learning.data.count).toBe(1) // 只 A 的
    const pos = learning.data.positions[0]
    expect(pos.courseTitle).toBe('零基础 · 钩织你的第一只小棉鸭')
    expect(pos.chapterTitle).toBe('开始之前 · 备好工具')
    expect(pos.lessonName).toBe('毛线与钩针怎么挑') // l2
    expect(pos.segmentName).toBe('选针') // l2-s2
    expect(pos.atSec).toBe(42)
    expect(pos.doneCount).toBe(3)
    expect(pos.totalSegments).toBe(5)
    expect(pos.percent).toBe(60) // 3/5
  })

  it('无 progress 客人：空 positions·不报错（错误隔离）', async () => {
    control.seed('courses', [COURSE])
    const learning = learningOf(parse(await getCustomer360(ctx({ openid: 'Z' }))))
    expect(learning.error).toBeUndefined()
    expect(learning.data.count).toBe(0)
    expect(learning.data.positions).toEqual([])
  })

  it('课程缺失（progress 指向已删课）：回退 courseId·不崩·完成度 0', async () => {
    control.seed('progress', [
      { _id: 'A__ghost', _openid: 'A', courseId: 'ghost', done: { x: true }, last: { lessonId: 'l9', segmentId: 'l9-s1' } },
    ])
    const pos = learningOf(parse(await getCustomer360(ctx({ openid: 'A' })))).data.positions[0]
    expect(pos.courseTitle).toBe('ghost') // 回退 id（课已删·不崩）
    expect(pos.chapterTitle).toBe('') // 定位不到 → 空串
    expect(pos.totalSegments).toBe(0)
    expect(pos.percent).toBe(0) // 分母 0 不除零
  })

  it('bounded：>200 课进度被显式上界截断·capped 标真（根因#7/#8 真尺寸）', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      _id: `A__k${i}`,
      _openid: 'A',
      courseId: `k${i}`,
      done: {},
      last: {},
    }))
    control.seed('progress', many)
    const data = learningOf(parse(await getCustomer360(ctx({ openid: 'A' })))).data
    expect(data.count).toBe(200) // .limit(200) 截断·不裸 .get() 吃默认 100
    expect(data.capped).toBe(true)
  })
})
