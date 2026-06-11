import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { activateCourse, getMyCourses } from '@/api/activation.js'
import { useActivationStore } from '@/store/activation.js'
import { COURSES } from '@/data/course.js'

beforeEach(() => setActivePinia(createPinia()))

// 测试环境无 wx.cloud → api 走 H5/App 演示模式回退（规格 §四-4）
describe('activation api 演示模式回退', () => {
  it('activateCourse 回退为激活成功 + 本地课程', async () => {
    const res = await activateCourse('ANYCODE')
    expect(res).toMatchObject({ ok: true, state: 'activated', courseId: COURSES[0].id })
  })

  it('getMyCourses 回退为全部课程已解锁', async () => {
    const list = await getMyCourses()
    expect(list.map((m) => m.courseId)).toEqual(COURSES.map((c) => c.id))
    for (const m of list) expect(m.enteredAt).toBeTruthy()
  })
})

describe('activation store', () => {
  it('loadMine 后 unlocked 按 courseId 判定', async () => {
    const s = useActivationStore()
    expect(s.unlocked('course-duck')).toBe(false) // load 前锁态（宁锁勿漏）
    await s.loadMine()
    expect(s.unlocked('course-duck')).toBe(true)
    expect(s.unlocked('course-nope')).toBe(false)
  })

  it('confirm 成功后本地同步解锁，不必强刷', async () => {
    const s = useActivationStore()
    const res = await s.confirm('CODE', 'course-x')
    expect(res.ok).toBe(true)
    expect(s.unlocked('course-x')).toBe(true)
  })
})

// 决策记录 §13：印刷物料走普通链接二维码（一码一地址），解析三轨兼容
import { parseActivationCode } from '@/api/activation.js'

describe('parseActivationCode（激活码三轨解析）', () => {
  it('?code= 直连（编译模式 / 体验版启动参数），裸码去空白', () => {
    expect(parseActivationCode({ code: ' LD2M67QXDDR6 ' })).toBe('LD2M67QXDDR6')
  })

  it('小程序码 scene：code=XX 与裸码两种写法', () => {
    expect(parseActivationCode({ scene: encodeURIComponent('code=LDABCD2345') })).toBe('LDABCD2345')
    expect(parseActivationCode({ scene: 'LDABCD2345' })).toBe('LDABCD2345')
  })

  it('普通链接二维码 ?q=：路径尾段式与 code= 查询参数式网址都认', () => {
    expect(parseActivationCode({ q: encodeURIComponent('https://example.com/q/LDABCD2345') })).toBe(
      'LDABCD2345',
    )
    expect(
      parseActivationCode({ q: encodeURIComponent('https://example.com/q/LDABCD2345?from=print') }),
    ).toBe('LDABCD2345')
    expect(
      parseActivationCode({ q: encodeURIComponent('https://example.com/act?code=LDABCD2345&x=1') }),
    ).toBe('LDABCD2345')
  })

  it('无码 / 不识别的网址 → 空串（走通用引导模式）', () => {
    expect(parseActivationCode()).toBe('')
    expect(parseActivationCode({})).toBe('')
    expect(parseActivationCode({ q: encodeURIComponent('https://example.com/') })).toBe('')
  })
})
