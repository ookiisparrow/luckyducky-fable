// 黄金 learning-content §七（评价）/§九（辅助视频）+ R37b（KB 精选 FAQ 公开读）（守卫 rw-reviews-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { __resetTempUrlCacheForTest } from '../src/kit/storage'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

beforeEach(() => {
  control.reset()
  __resetTempUrlCacheForTest() // 批1·清签发缓存·隔离跨 case 复用相同晒图 fileID 的污染（getReviews 买家秀走 maxAge）
  control.setOpenId('oME')
})

describe('getHelpVideos（两级白名单·不漏源·黄金 §九）', () => {
  it('大白话：无记录返回空列表；主题层不含视频源、小段换短时地址、无视频段地址为空', async () => {
    expect((await call('getHelpVideos')).items).toEqual([])

    control.seed('content', [
      {
        _id: 'helpVideos',
        items: [
          {
            id: 't1',
            title: '起针问题',
            sub: '副题',
            desc: '说明',
            secret: '内部备注',
            segments: [
              { id: 'g1', name: '第一段', dur: '1:00', videoFileId: 'cloud://h/g1.mp4' },
              { id: 'g2', name: '未剪', dur: '', videoFileId: '' },
            ],
          },
        ],
      },
    ])
    const r = await call('getHelpVideos')
    const raw = JSON.stringify(r)
    expect(raw.includes('videoFileId')).toBe(false)
    expect(raw.includes('secret')).toBe(false)
    expect(r.items[0].segments[0].url).toBe('https://tmp/cloud://h/g1.mp4')
    expect(r.items[0].segments[1].url).toBe(null)
  })

  it('大白话：大量视频分批换址（≤50/批）、全量换到、映射不串位', async () => {
    const segments = Array.from({ length: 60 }, (_, i) => ({
      id: 'g' + i,
      name: '段' + i,
      dur: '1:00',
      videoFileId: `cloud://h/v${i}.mp4`,
    }))
    control.seed('content', [{ _id: 'helpVideos', items: [{ id: 't1', title: 'T', segments }] }])
    const r = await call('getHelpVideos')
    const segs = r.items[0].segments
    expect(segs.length).toBe(60)
    for (let i = 0; i < 60; i++) expect(segs[i].url).toBe(`https://tmp/cloud://h/v${i}.mp4`)
  })
})

describe('getReviews（游标分页+全量精确汇总·黄金 §七）', () => {
  it('大白话：缺商品标识拒；空集合计数 0 评分 0 分布全 0 不标近似', async () => {
    expect((await call('getReviews')).error).toBe('NO_PRODUCT')
    const r = await call('getReviews', { productId: 'p1' })
    expect(r.summary.count).toBe(0)
    expect(r.summary.score).toBe('0')
    expect(r.summary.approx).toBe(false)
  })

  it('大白话：汇总全量精确——评价数超样本上限仍精确不标近似；1 星并入 2 星档；只统计本商品', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      _id: 'r' + i,
      productId: 'p1',
      rating: i % 2 ? 5 : 4,
      tags: ['好评'],
      createdAt: i,
    }))
    const lowStars = Array.from({ length: 30 }, (_, i) => ({
      _id: 'x' + i,
      productId: 'p1',
      rating: 1,
      createdAt: 900 + i,
    }))
    control.seed('reviews', [...many, ...lowStars, { _id: 'other', productId: 'p2', rating: 3, createdAt: 991 }])
    const r = await call('getReviews', { productId: 'p1' })
    expect(r.summary.count).toBe(280) // 250+30 一星·p2 不混入
    expect(r.summary.score).toBe('4.1') // (125*5+125*4+30*1)/280=4.125→toFixed(1)（钉住批C 汇总数值正确性，非仅样本近似）
    expect(r.summary.approx).toBe(false)
    const dist = Object.fromEntries(r.summary.dist)
    expect(dist['2 星']).toBeGreaterThan(0) // 1 星并入 2 星档
    expect(r.summary.tags[0][0]).toBe('好评')
  })

  it('大白话：精确聚合异常时落回兜底近样本口径——恰好 200 条（=SUMMARY_SAMPLE）其实是全量，不该误标近似（差一修复·P3）；201 条才真被截断标近似且只统计前 200 条', async () => {
    control.setBeforeCount(({ coll }: any) => {
      if (coll === 'reviews') throw new Error('MOCK_COUNT_FAIL') // 逼精确聚合六路 Promise.all 任一路失败→落回兜底
    })
    control.seed(
      'reviews',
      Array.from({ length: 200 }, (_, i) => ({ _id: 'r' + i, productId: 'p1', rating: 5, createdAt: i }))
    )
    const r200 = await call('getReviews', { productId: 'p1' })
    expect(r200.summary.count).toBe(200)
    expect(r200.summary.approx).toBe(false) // 恰好占满上限＝全量，不是被截断，不该标近似

    control.seed('reviews', [{ _id: 'r200', productId: 'p1', rating: 5, createdAt: 200 }]) // 第 201 条
    const r201 = await call('getReviews', { productId: 'p1' })
    expect(r201.summary.count).toBe(200) // 真被截断只统计前 200（多取的那条只用于探测截断，不参与聚合）
    expect(r201.summary.approx).toBe(true)

    control.setBeforeCount(null as never)
  })

  it('大白话：首页倒序+游标续页不重不漏；续页不重算汇总；到底无更多', async () => {
    control.seed(
      'reviews',
      Array.from({ length: 25 }, (_, i) => ({ _id: 'r' + i, productId: 'p1', rating: 5, createdAt: 1000 + i }))
    )
    const p1 = await call('getReviews', { productId: 'p1', limit: 10 })
    expect(p1.list.length).toBe(10)
    expect(p1.hasMore).toBe(true)
    expect(p1.summary).toBeTruthy()
    const p2 = await call('getReviews', { productId: 'p1', limit: 10, cursor: p1.nextCursor })
    expect(p2.summary).toBeUndefined() // 续页不重算（前端缓存首页汇总）
    const p3 = await call('getReviews', { productId: 'p1', limit: 10, cursor: p2.nextCursor })
    expect(p3.hasMore).toBe(false)
    const ids = new Set([...p1.list, ...p2.list, ...p3.list].map((r: any) => r.createdAt))
    expect(ids.size).toBe(25)
  })
})

describe('getRatingSummary（详情页评分摘要·slim·公开只读·C 类竖切）', () => {
  it('大白话：缺商品标识拒；空集合 count=0 score=0（前端据此不渲染假评）', async () => {
    expect((await call('getRatingSummary')).error).toBe('NO_PRODUCT')
    const r = await call('getRatingSummary', { productId: 'p1' })
    expect(r.count).toBe(0)
    expect(r.score).toBe('0')
  })
  it('大白话：有评价时 score=均分保留一位、count=本商品评价数；他商品不混入；slim 不下发列表/图/标签', async () => {
    control.seed('reviews', [
      { _id: 'a', productId: 'p1', rating: 5, tags: ['棒'], photos: ['cloud://a.jpg'], createdAt: 1 },
      { _id: 'b', productId: 'p1', rating: 4, createdAt: 2 },
      { _id: 'c', productId: 'p1', rating: 3, createdAt: 3 },
      { _id: 'z', productId: 'p2', rating: 1, createdAt: 4 },
    ])
    const r = await call('getRatingSummary', { productId: 'p1' })
    expect(r.count).toBe(3) // p2 不混入
    expect(r.score).toBe('4.0') // (5+4+3)/3
    expect(r.list).toBeUndefined() // slim·不下发列表
    expect(JSON.stringify(r)).not.toContain('cloud://') // 不带图/裸 fileID·公开只读只回聚合数
  })
})

describe('submitReview（多重闸门·一单一行一评·黄金 §七）', () => {
  const seedOrder = (id = 'o1', status = 'done') =>
    control.seed('orders', [
      {
        _id: id,
        id,
        _openid: 'oME',
        status,
        items: [
          { productId: 'p1', lineId: 'p1__红', spec: '红', qty: 1 },
          { productId: 'p1', lineId: 'p1__蓝', spec: '蓝', qty: 1 },
        ],
      },
    ])

  it('大白话：评分越界拒；他人订单不可评；未完成不可评；商品不在单内不可评', async () => {
    seedOrder('o1')
    seedOrder('oShip', 'shipped')
    expect((await call('submitReview', { orderId: 'o1', lineId: 'p1__红', rating: 6 })).error).toBe('BAD_RATING')
    control.setOpenId('oOTHER')
    expect((await call('submitReview', { orderId: 'o1', lineId: 'p1__红', rating: 5 })).error).toBe('NOT_FOUND')
    control.setOpenId('oME')
    expect((await call('submitReview', { orderId: 'oShip', lineId: 'p1__红', rating: 5 })).error).toBe('NOT_DONE')
    expect((await call('submitReview', { orderId: 'o1', lineId: 'nope', rating: 5 })).error).toBe('NOT_IN_ORDER')
  })

  it('大白话：成功提交带昵称快照与规格；匿名存匿名占位名', async () => {
    seedOrder()
    control.seed('users', [{ _id: 'oME', _openid: 'oME', nickname: '幸运鸭' }])
    await call('submitReview', { orderId: 'o1', lineId: 'p1__红', rating: 5, text: ' 好 ', tags: ['棒'] })
    const r1 = control.dump('reviews').find((r: any) => r.lineId === 'p1__红')
    expect(r1.name).toBe('幸运鸭')
    expect(r1.spec).toBe('红')
    expect(r1.text).toBe('好')
    await call('submitReview', { orderId: 'o1', lineId: 'p1__蓝', rating: 4, anon: true })
    expect(control.dump('reviews').find((r: any) => r.lineId === 'p1__蓝').name).toBe('匿名钩友')
  })

  it('大白话：一单一行一评——重复提交拒；同商品不同规格各自可评不互撞', async () => {
    seedOrder()
    expect((await call('submitReview', { orderId: 'o1', lineId: 'p1__红', rating: 5 })).ok).toBe(true)
    expect((await call('submitReview', { orderId: 'o1', lineId: 'p1__红', rating: 1 })).error).toBe('REVIEWED')
    expect((await call('submitReview', { orderId: 'o1', lineId: 'p1__蓝', rating: 4 })).ok).toBe(true)
    expect(control.dump('reviews').length).toBe(2)
  })

  it('大白话：旧单无行键按商品键兼容评价', async () => {
    control.seed('orders', [
      { _id: 'o2', id: 'o2', _openid: 'oME', status: 'done', items: [{ productId: 'p9', qty: 1 }] },
    ])
    expect((await call('submitReview', { orderId: 'o2', productId: 'p9', rating: 5 })).ok).toBe(true)
    expect(control.dump('reviews')[0].lineId).toBe('p9')
  })

  it('大白话：买家秀晒图入库前逐张过内容安全——过则存 fileID；任一张违规/校不了→整条拒不落库（fail-closed·根因#3）', async () => {
    seedOrder()
    // 两张图过内容安全 → 落库存 fileID（≤9·去空）
    expect((await call('submitReview', { orderId: 'o1', lineId: 'p1__红', rating: 5, photos: ['cloud://a.jpg', '', 'cloud://b.jpg'] })).ok).toBe(true)
    expect(control.dump('reviews').find((r: any) => r.lineId === 'p1__红').photos).toEqual(['cloud://a.jpg', 'cloud://b.jpg'])
    // 违规图（平台判 87014）→ 整条拒、一条不落（换一行避开一单一行一评撞主键）
    control.setOpenapiFail(true, 87014)
    expect((await call('submitReview', { orderId: 'o1', lineId: 'p1__蓝', rating: 5, photos: ['cloud://ok.jpg', 'cloud://bad.jpg'] })).error).toBe('IMG_RISKY')
    expect(control.dump('reviews').find((r: any) => r.lineId === 'p1__蓝')).toBeUndefined()
    // 校不了（能力未开/网络·非违规码）→ 同样拒（证明安全才放行）
    control.setOpenapiFail(true)
    expect((await call('submitReview', { orderId: 'o1', lineId: 'p1__蓝', rating: 5, photos: ['cloud://x.jpg'] })).error).toBe('SEC_CHECK_FAIL')
    expect(control.dump('reviews').find((r: any) => r.lineId === 'p1__蓝')).toBeUndefined()
  })

  it('大白话：列表回图把 fileID 换成短时地址下发（不出裸 fileID）；无图评价 photos 空数组', async () => {
    control.seed('reviews', [
      { _id: 'r1', productId: 'p1', rating: 5, photos: ['cloud://a.jpg', 'cloud://b.jpg'], createdAt: 20 },
      { _id: 'r2', productId: 'p1', rating: 4, createdAt: 10 },
    ])
    const rv = await call('getReviews', { productId: 'p1' })
    const first = rv.list.find((r: any) => r.createdAt === 20)
    expect(first.photos).toEqual(['https://tmp/cloud://a.jpg', 'https://tmp/cloud://b.jpg']) // 短时址·非裸 fileID
    expect(rv.list.find((r: any) => r.createdAt === 10).photos).toEqual([]) // 无图 → 空数组
  })
})

describe('getPublicFaq（R37b·KB 精选 FAQ 公开读·守卫 faq-via-kb-single-source 扩面）', () => {
  it('大白话：只回 featured=true 的条目，字段瘦身 {key,title,content}——不带 category/order/enabled 等 kb 管理元数据', async () => {
    control.seed('kb', [
      { _id: 'logistics:eta', question: '什么时候发货？', answer: '付款后 48 小时内发货。', category: 'logistics', order: 1, enabled: true, featured: true },
      { _id: 'activation:howto', question: '激活码怎么用？', answer: '扫码激活。', category: 'activation', order: 0, enabled: true, featured: false }, // 非精选·不下发
    ])
    const r = await call('getPublicFaq')
    expect(r.items).toEqual([{ key: 'logistics:eta', title: '什么时候发货？', content: '付款后 48 小时内发货。' }])
    const raw = JSON.stringify(r)
    expect(raw.includes('category')).toBe(false) // 不带管理元数据
    expect(raw.includes('enabled')).toBe(false)
    expect(raw.includes('activation:howto')).toBe(false) // 非精选条目不下发
  })

  it('大白话：精选但被禁用(enabled:false)的条目同样不下发；无精选条目时回空列表；无鉴权（未设 openid 也能读）', async () => {
    control.reset() // 清空登录态·验证公开读无需 openid（同 getProducts/getContent 口径）
    control.seed('kb', [{ _id: 'x', question: 'q', answer: 'a', featured: true, enabled: false }])
    expect((await call('getPublicFaq')).items).toEqual([])
  })

  it('大白话：bounded 上限 20——精选条目多于上限时只回前 20 条，不无界下发', async () => {
    control.seed(
      'kb',
      Array.from({ length: 25 }, (_, i) => ({ _id: 'k' + i, question: 'q' + i, answer: 'a' + i, featured: true }))
    )
    const r = await call('getPublicFaq')
    expect(r.items.length).toBe(20)
  })

  it('大白话：按 admin 策展的 order 字段升序下发（同 listKb order 口径），不是数据库任意返回序', async () => {
    control.seed('kb', [
      { _id: 'c', question: 'q-c', answer: 'a-c', featured: true, order: 2 },
      { _id: 'a', question: 'q-a', answer: 'a-a', featured: true, order: 0 },
      { _id: 'b', question: 'q-b', answer: 'a-b', featured: true, order: 1 },
    ])
    const r = await call('getPublicFaq')
    expect(r.items.map((x: any) => x.key)).toEqual(['a', 'b', 'c'])
  })
})
