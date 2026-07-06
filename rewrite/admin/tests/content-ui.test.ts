// 内容组映射（守卫 rw-admin-content-ui-golden）：首页模型往返（旧单串值归一/空课行剔除）/
// 直传表单字段构造（调试日志 G 固化：key 截取·字段名精确·凭证不齐不发）/课程视频统计脏档安全。
import { describe, it, expect } from 'vitest'
import { normalizeHome, homePayload, uploadFormFields, courseVideoStats, normalizeHelpItems } from '../src/lib/mapContent'

describe('首页模型往返', () => {
  it('大白话：旧存档「按课单串值」归一成欢迎图；编辑后空课行剔除、空态字段不进载荷', () => {
    const m = normalizeHome({
      hero: { title: '创造幸运', tagline: 'x' },
      activationBgByCourse: { 'course-a': 'cloud://old-style.jpg', 'course-b': { welcome: 'cloud://w.jpg', taken: 'cloud://t.jpg' } },
    })
    expect(m.byCourse).toEqual([
      { courseId: 'course-a', welcome: 'cloud://old-style.jpg', welcomeBack: '', taken: '' },
      { courseId: 'course-b', welcome: 'cloud://w.jpg', welcomeBack: '', taken: 'cloud://t.jpg' },
    ])
    m.byCourse.push({ courseId: '  ', welcome: 'cloud://x.jpg', welcomeBack: '', taken: '' }) // 空课行
    const payload = homePayload(m) as Record<string, any>
    expect(Object.keys(payload.activationBgByCourse)).toEqual(['course-a', 'course-b']) // 空课剔除
    expect(payload.activationBgByCourse['course-b']).toEqual({ welcome: 'cloud://w.jpg', taken: 'cloud://t.jpg' }) // 空态不进
    expect(normalizeHome(null).heroTitle).toBe('') // 缺档全默认
  })

  it('大白话：同 courseId 两行按状态位合并、不末行胜丢图（防重复键静默覆盖·同 Kb/Checkpoints 危险）', () => {
    const m = normalizeHome(null)
    m.byCourse = [
      { courseId: 'course-duck', welcome: 'cloud://welcome.jpg', welcomeBack: '', taken: '' },
      { courseId: 'course-duck', welcome: '', welcomeBack: 'cloud://back.jpg', taken: '' }, // 同课·另一态
    ]
    const payload = homePayload(m) as Record<string, any>
    // 合并：欢迎图(前行) + 回访图(后行)都在——旧「整块替换」会只剩回访图、欢迎图丢失
    expect(payload.activationBgByCourse['course-duck']).toEqual({ welcome: 'cloud://welcome.jpg', welcomeBack: 'cloud://back.jpg' })
    expect(Object.keys(payload.activationBgByCourse)).toEqual(['course-duck']) // 合成一课
  })

  it('大白话：首页九板块文案/图往返——hero搜索+图、品牌、特写、放心、买家秀、收尾、页脚都进档；空块/空态/空链剔除', () => {
    const m = normalizeHome({
      hero: { title: '创造幸运', tagline: 't', search: '入门钩织的妙趣方式', img: 'cloud://hero.jpg' },
      brand: { name: '易织™小棉鸭®', lead: '亲手创造随身幸运物' },
      feature: { title: '妙趣方案', body: '精心设计', img: 'cloud://feat.jpg' },
      reassure: {
        heading: '把门槛拆掉',
        lead: '门槛一一拆掉',
        items: [
          { icon: 'heart-handshake', title: '放心开始', body: '全材料包', img: 'cloud://r1.jpg' },
          { icon: 'shield-check', title: '难以失败', body: '可回看' },
        ],
      },
      reviews: { heading: '真实买家秀', items: [{ quote: '第一次就成功', user: '小满', img: 'cloud://rv1.jpg' }] },
      closing: { title: '创造幸运', cta: 'Get ducky get lucky', img: 'cloud://close.jpg' },
      footer: { links: ['关于我们', 'Lucky 鸭'], copy: 'Copyright © 2026' },
    })
    // 往：档 → 编辑模型逐字段落位
    expect(m.heroSearch).toBe('入门钩织的妙趣方式')
    expect(m.heroImg).toBe('cloud://hero.jpg')
    expect(m.brandName).toBe('易织™小棉鸭®')
    expect(m.brandLead).toBe('亲手创造随身幸运物')
    expect(m.featureTitle).toBe('妙趣方案')
    expect(m.featureImg).toBe('cloud://feat.jpg')
    expect(m.reassureHeading).toBe('把门槛拆掉')
    expect(m.reassureItems).toEqual([
      { icon: 'heart-handshake', title: '放心开始', body: '全材料包', img: 'cloud://r1.jpg' },
      { icon: 'shield-check', title: '难以失败', body: '可回看', img: '' },
    ])
    expect(m.reviewsItems).toEqual([{ quote: '第一次就成功', user: '小满', img: 'cloud://rv1.jpg' }])
    expect(m.closingCta).toBe('Get ducky get lucky')
    expect(m.footerLinks).toEqual(['关于我们', 'Lucky 鸭'])
    expect(m.footerCopy).toBe('Copyright © 2026')

    // 返：编辑模型 → 载荷（空块/空态/空链剔除·与云端白名单同构）
    m.reassureItems.push({ icon: '', title: '', body: '', img: '' }) // 空块
    m.reviewsItems.push({ quote: '  ', user: '匿名', img: '' }) // 空评价
    m.footerLinks.push('   ') // 空链
    const p = homePayload(m) as Record<string, any>
    expect(p.hero).toEqual({ title: '创造幸运', tagline: 't', search: '入门钩织的妙趣方式', img: 'cloud://hero.jpg' })
    expect(p.brand).toEqual({ name: '易织™小棉鸭®', lead: '亲手创造随身幸运物' })
    expect(p.reassure.items).toHaveLength(2) // 空块剔除
    expect(p.reviews.items).toHaveLength(1) // 空评价剔除（quote 全空白）
    expect(p.closing).toEqual({ title: '创造幸运', cta: 'Get ducky get lucky', img: 'cloud://close.jpg' })
    expect(p.footer.links).toEqual(['关于我们', 'Lucky 鸭']) // 空链剔除
    // 缺档：新板块字段全默认空串（编辑器显占位提示·小程序读侧回退设计文案）
    expect(normalizeHome(null).brandName).toBe('')
    expect(normalizeHome(null).reassureItems).toEqual([])
  })
})

describe('直传表单字段（调试日志 G：错一个字段云存储 403）', () => {
  it('大白话：key 从 fileId 截路径；三个 x-cos/Signature 字段名一字不差；凭证缺任一不发', () => {
    const fields = uploadFormFields({
      fileId: 'cloud://env-id.bucket-123/videos/c1/seg-1.mp4',
      authorization: 'q-sign-xxx',
      token: 'tok-yyy',
      cosFileId: 'cos-zzz',
    })!
    expect(fields).toEqual({
      key: 'videos/c1/seg-1.mp4', // cloud://<env>.<bucket>/ 后的对象路径
      Signature: 'q-sign-xxx',
      'x-cos-security-token': 'tok-yyy',
      'x-cos-meta-fileid': 'cos-zzz',
    })
    expect(uploadFormFields({ fileId: 'cloud://a/b.mp4', authorization: 'x', token: 'y' })).toBeNull() // 缺 cosFileId 不发
    expect(uploadFormFields({})).toBeNull()
  })
})

describe('课程视频统计与帮助视频归一', () => {
  it('大白话：已传/总段数统计；缺层脏档不崩；帮助视频两级归一非数组安全', () => {
    expect(
      courseVideoStats({
        chapters: [
          { lessons: [{ segments: [{ videoFileId: 'cloud://a' }, { videoFileId: '' }] }] },
          { lessons: null },
          null,
        ],
      })
    ).toEqual({ total: 2, done: 1 })
    expect(courseVideoStats(null)).toEqual({ total: 0, done: 0 })
    const help = normalizeHelpItems([{ title: 't', segments: [{ name: 's', videoFileId: 'cloud://v' }] }, null])
    expect(help).toHaveLength(1) // null 项剔除
    expect(help[0].segments[0].videoFileId).toBe('cloud://v')
    expect(normalizeHelpItems('garbage')).toEqual([])
  })
})
