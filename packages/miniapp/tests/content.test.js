import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useContentStore } from '@/store/content.js'
import { TRUST_ITEMS } from '@/data/trust.js'
import { FAQ_ITEMS } from '@/data/faq.js'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  delete globalThis.wx
})

describe('content store（首页内容：云端编辑 + 本地默认兜底）', () => {
  it('无云（H5 / 测试环境）：hero/trust/faq 全回退本地默认', async () => {
    const s = useContentStore()
    await s.load()
    expect(s.hero.title).toBe('创造幸运')
    expect(s.trust).toEqual(TRUST_ITEMS)
    expect(s.faq).toEqual(FAQ_ITEMS)
  })

  it('云端有内容：按块覆盖；空块仍用默认（防误清空线上）', async () => {
    globalThis.wx = {
      cloud: {
        callFunction: async () => ({
          result: { ok: true, home: { hero: { title: '六月上新', tagline: '' }, trust: [], faq: [{ title: 'Q', body: 'A' }] } },
        }),
      },
    }
    const s = useContentStore()
    await s.load()
    expect(s.hero.title).toBe('六月上新')
    expect(s.hero.tagline).toBe('Get ducky get lucky') // 空字段回退默认
    expect(s.trust).toEqual(TRUST_ITEMS) // 空数组回退默认
    expect(s.faq).toEqual([{ title: 'Q', body: 'A' }])
  })
})

// 激活欢迎图按「课程×状态」取图（用户拍板 2026-06-18）：欢迎页 welcome / 欢迎回来 welcomeBack /
// 已被激活 taken 三态按课程；正在激活 loadingBg 全局；全部回退全局 activationBg→（空＝页面再回退 static）。
const seedHome = (home) => {
  globalThis.wx = { cloud: { callFunction: async () => ({ result: { ok: true, home } }) } }
}

describe('content store · 激活欢迎图按课程×状态', () => {
  it('loadingBg：全局·正在激活图', async () => {
    seedHome({ loadingBg: 'cloud://load.jpg', activationBg: 'cloud://glob.jpg' })
    const s = useContentStore()
    await s.load()
    expect(s.loadingBg).toBe('cloud://load.jpg')
    expect(s.activationBg).toBe('cloud://glob.jpg')
  })

  it('activationBgFor(courseId, state)：该课该态配了→用它', async () => {
    seedHome({
      activationBg: 'cloud://glob.jpg',
      activationBgByCourse: {
        'course-duck': { welcome: 'cloud://w.jpg', welcomeBack: 'cloud://wb.jpg', taken: 'cloud://tk.jpg' },
      },
    })
    const s = useContentStore()
    await s.load()
    expect(s.activationBgFor('course-duck', 'welcome')).toBe('cloud://w.jpg')
    expect(s.activationBgFor('course-duck', 'welcomeBack')).toBe('cloud://wb.jpg')
    expect(s.activationBgFor('course-duck', 'taken')).toBe('cloud://tk.jpg')
  })

  it('该课该态未配 / 无 courseId → 回退全局 activationBg', async () => {
    seedHome({
      activationBg: 'cloud://glob.jpg',
      activationBgByCourse: { 'course-duck': { welcome: 'cloud://w.jpg' } },
    })
    const s = useContentStore()
    await s.load()
    expect(s.activationBgFor('course-duck', 'welcomeBack')).toBe('cloud://glob.jpg') // 该态未配→全局
    expect(s.activationBgFor('course-other', 'welcome')).toBe('cloud://glob.jpg') // 该课未配→全局
    expect(s.activationBgFor('', 'welcome')).toBe('cloud://glob.jpg') // 无码→全局
  })

  it('全空 → 返回空串（页面再回退 /static/hero-full.jpg）', async () => {
    seedHome({})
    const s = useContentStore()
    await s.load()
    expect(s.activationBgFor('course-duck', 'welcome')).toBe('')
    expect(s.loadingBg).toBe('')
  })

  it('兼容旧结构（值为字符串＝welcome 那张）', async () => {
    seedHome({ activationBgByCourse: { 'course-duck': 'cloud://legacy.jpg' } })
    const s = useContentStore()
    await s.load()
    expect(s.activationBgFor('course-duck', 'welcome')).toBe('cloud://legacy.jpg') // 旧字符串当 welcome
    expect(s.activationBgFor('course-duck', 'welcomeBack')).toBe('') // 旧结构没有其他态
  })

  it('默认 state＝welcome（不传 state 时取欢迎页·兼容旧调用）', async () => {
    seedHome({ activationBgByCourse: { 'course-duck': { welcome: 'cloud://w.jpg' } } })
    const s = useContentStore()
    await s.load()
    expect(s.activationBgFor('course-duck')).toBe('cloud://w.jpg')
  })
})
