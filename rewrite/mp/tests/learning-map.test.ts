// 黄金 learning-content §一（激活三态：新激活/本人回访/他人码/废码）+ §九（背景回退链）
// （守卫 rw-mp-learning-golden）。
import { describe, it, expect } from 'vitest'
import { activationView, bgFor, mapMyCourses } from '../lib/mapLearning'

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
