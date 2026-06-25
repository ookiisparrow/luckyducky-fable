import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// adminApi 上新流水线 + 内容/卡片/批次 特征锁（B5b：拆 actions 前锁住现行为，拆后此套必须仍全过）。
const KEY = 'admin-pipeline-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
async function call(action, data = {}, key = KEY) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}
beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
})

describe('adminApi HTTP 外壳 + 口令闸', () => {
  it('OPTIONS 预检 204；非 POST 405；坏 JSON 400', async () => {
    expect((await main({ httpMethod: 'OPTIONS' })).statusCode).toBe(204)
    expect((await main({ httpMethod: 'GET' })).statusCode).toBe(405)
    const bad = await main({ httpMethod: 'POST', body: '{not json' })
    expect(bad.statusCode).toBe(400)
  })
  it('ping 免口令；其余 action 口令错 401', async () => {
    expect((await call('ping')).ok).toBe(true)
    expect((await call('listDrafts', {}, 'wrong')).status).toBe(401)
  })
  it('login bootstrap：须匹配部署密钥才首登设口令（债#15 关抢占窗口）', async () => {
    control.reset() // 无 adminConfig
    delete process.env.ADMIN_BOOTSTRAP_KEY
    expect((await call('login', {}, 'brand-new-key')).status).toBe(401) // 未设部署密钥→禁 bootstrap
    process.env.ADMIN_BOOTSTRAP_KEY = 'deploy-secret-xyz'
    expect((await call('login', {}, 'wrong-key-aaa')).status).toBe(401) // 口令不匹配部署密钥→拒
    const r = await call('login', {}, 'deploy-secret-xyz') // 匹配→首登设口令
    expect(r.ok).toBe(true)
    expect(r.bootstrapped).toBe(true)
    expect((await call('login', {}, 'another-key')).status).toBe(401) // 已设，他码被拒
    delete process.env.ADMIN_BOOTSTRAP_KEY
  })
})

describe('adminApi 商品草稿 → 上架（特征锁）', () => {
  it('saveDraft 白名单清洗（截断 + 丢杂字段）+ listDrafts 取回', async () => {
    const r = await call('saveDraft', {
      product: { id: 'p1', name: '鸭'.repeat(100), price: '198', evil: '应丢', skus: [{ name: '蓝', price: '210' }] },
    })
    expect(r.ok).toBe(true)
    const list = await call('listDrafts')
    const p = list.list.find((x) => x.id === 'p1')
    expect(p.name).toHaveLength(60) // 截断 60
    expect(p.evil).toBeUndefined() // 非白名单丢弃
    expect(p.status).toBe('preparing')
  })

  it('publishProduct 四道门：NEED_COVER / NEED_INFO / NEED_SKUS / 成功转数字+首发 featured', async () => {
    await call('saveDraft', { product: { id: 'p1', name: 'duck' } })
    expect((await call('publishProduct', { id: 'p1' })).error).toBe('NEED_COVER')

    await call('saveDraft', { product: { id: 'p1', name: '', price: '', cover: 'cloud://x', skus: [] } })
    expect((await call('publishProduct', { id: 'p1' })).error).toBe('NEED_INFO')

    await call('saveDraft', { product: { id: 'p1', name: 'duck', price: '198', cover: 'cloud://x', skus: [] } })
    expect((await call('publishProduct', { id: 'p1' })).error).toBe('NEED_SKUS')

    await call('saveDraft', {
      product: { id: 'p1', name: 'duck', price: '198', cover: 'cloud://x', skus: [{ name: '蓝', price: '210' }] },
    })
    expect((await call('publishProduct', { id: 'p1' })).ok).toBe(true)
    const prod = control.dump('products').find((p) => p.id === 'p1')
    expect(prod.price).toBe(198) // 字符串 → 数字
    expect(prod.skus[0].price).toBe(210)
    expect(prod.featured).toBe(true) // 首次上架默认上首页
    expect(control.dump('productsDraft').find((d) => d.id === 'p1').status).toBe('onsale')
  })

  it('saveShowcase 改 sort/featured；listShowcase 升序', async () => {
    control.seed('products', [
      { _id: 'a', id: 'a', sort: 1, featured: true },
      { _id: 'b', id: 'b', sort: 2, featured: false },
    ])
    await call('saveShowcase', { items: [{ id: 'a', sort: 5, featured: false }] })
    expect(control.dump('products').find((p) => p._id === 'a').featured).toBe(false)
    expect(control.dump('products').find((p) => p._id === 'a').sort).toBe(5)
  })
})

describe('adminApi 课程草稿 / 卡片 / 内容 / 批次（特征锁）', () => {
  it('saveCourseDraft 三层清洗 + publishCourse 覆盖 courses（NO_DRAFT 守卫）', async () => {
    expect((await call('publishCourse', { courseId: 'c-x' })).error).toBe('NO_DRAFT')
    await call('saveCourseDraft', {
      course: { id: 'c-x', title: '小鸭课', chapters: [{ id: 'ch1', title: '章', lessons: [{ id: 'l1', name: '课', dur: '03:00', segments: [] }] }] },
    })
    expect((await call('publishCourse', { courseId: 'c-x' })).ok).toBe(true)
    const pub = control.dump('courses').find((c) => c._id === 'c-x')
    expect(pub.title).toBe('小鸭课')
    expect(pub.chapters[0].lessons[0].name).toBe('课')
  })

  it('saveCard 双面 + 颜色校验 + 尺寸夹取；getCard 取回', async () => {
    await call('saveCard', {
      card: { productId: 'p1', name: '小鸭卡', front: { bg: 'nothex' }, sizeMM: { w: 9999, h: 10 } },
    })
    const r = await call('getCard', { productId: 'p1' })
    expect(r.card.front.bg).toBe('#f6e9b8') // 非法 hex 回默认
    expect(r.card.sizeMM.w).toBe(300) // 夹到上限
    expect(r.card.sizeMM.h).toBe(40) // 夹到下限
  })

  it('saveHomeContent 白名单 + getHomeContent 取回', async () => {
    await call('saveHomeContent', { home: { hero: { title: 'T'.repeat(50), tagline: 'x' }, trust: [{ icon: 'i', label: 'l' }], faq: [] } })
    const r = await call('getHomeContent')
    expect(r.home.hero.title).toHaveLength(20) // 截断
    expect(r.home.trust[0].label).toBe('l')
  })

  it('saveHelpVideos 两级白名单（主题/小段限长 + 封顶 + 剔无视频小段）+ listHelpVideos 取回原始 fileID', async () => {
    // 25 主题全有效 → 封顶 20；首主题标题/小段名超长 → 截断 40；无视频小段剔除；管理端读回原始 videoFileId
    await call('saveHelpVideos', {
      items: [
        {
          id: 'h1',
          title: 'T'.repeat(80),
          sub: 's',
          desc: 'd',
          segments: [
            { id: 's1', name: 'N'.repeat(80), dur: '00:30', videoFileId: 'cloud://v1' },
            { id: 's2', name: '空段', dur: '', videoFileId: '' }, // 无视频小段 → 剔除
          ],
        },
        ...Array.from({ length: 24 }, (_, i) => ({ title: 'x' + i, segments: [{ videoFileId: 'cloud://x' + i }] })),
      ],
    })
    const r = await call('listHelpVideos')
    expect(r.items.length).toBe(20) // 主题封顶 20
    expect(r.items[0].title).toHaveLength(40) // 主题标题截断
    expect(r.items[0].segments).toHaveLength(1) // 无视频小段被剔除
    expect(r.items[0].segments[0].name).toHaveLength(40) // 小段名截断
    expect(r.items[0].segments[0].videoFileId).toBe('cloud://v1') // 管理端读回原始 fileID（已过口令闸）
  })

  it('saveHelpVideos 剔除空主题（无标题且无带视频小段）', async () => {
    await call('saveHelpVideos', {
      items: [
        { title: '起手结', segments: [{ videoFileId: 'cloud://a' }] },
        { title: '', sub: '只填了副标题', segments: [{ videoFileId: '' }] }, // 无标题 + 无带视频小段 → 剔除
      ],
    })
    const r = await call('listHelpVideos')
    expect(r.items.length).toBe(1)
    expect(r.items[0].title).toBe('起手结')
  })

  it('createBatch 互调 genQrcodes（mock 返回）+ listBatches 聚合 + listBatchCodes', async () => {
    control.setCallFunctionResult({ result: { ok: true, batchId: 'b-1', codes: ['LDAAA', 'LDBBB'] } })
    const r = await call('createBatch', { courseId: 'course-duck', count: 2 })
    expect(r.ok).toBe(true)
    expect(r.batchId).toBe('b-1')
    expect(control.callFunctionCalls()[0].name).toBe('genQrcodes')

    control.seed('qrcodes', [
      { _id: 'LD1', batchId: 'b-1', courseId: 'course-duck', status: 'unused', createdAt: 1 },
      { _id: 'LD2', batchId: 'b-1', courseId: 'course-duck', status: 'activated', createdAt: 1 },
    ])
    const lb = await call('listBatches', { courseId: 'course-duck' })
    expect(lb.list[0]).toMatchObject({ batchId: 'b-1', total: 2, activated: 1 })
    const lc = await call('listBatchCodes', { batchId: 'b-1' })
    expect(lc.codes.sort()).toEqual(['LD1', 'LD2'])
  })
})
