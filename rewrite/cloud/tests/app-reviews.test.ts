// 黄金 learning-content §七（评价）/§九（辅助视频）（守卫 rw-reviews-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

beforeEach(() => {
  control.reset()
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
    expect(r.summary.approx).toBe(false)
    const dist = Object.fromEntries(r.summary.dist)
    expect(dist['2 星']).toBeGreaterThan(0) // 1 星并入 2 星档
    expect(r.summary.tags[0][0]).toBe('好评')
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
})
