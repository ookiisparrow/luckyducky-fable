// 黄金 learning-content §一–§五（守卫 rw-learning-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

const COURSE = {
  _id: 'c1',
  id: 'c1',
  title: '小鸭课',
  sort: 1,
  chapters: [
    {
      id: 'ch1',
      title: '第一章',
      lessons: [
        {
          id: 'l1',
          name: '第一节',
          dur: '10:00',
          segments: [
            { id: 's1', name: '起针', dur: '5:00', videoFileId: 'cloud://v/s1.mp4', free: true },
            { id: 's2', name: '长针', dur: '5:00', videoFileId: '' },
          ],
        },
      ],
    },
  ],
}

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  control.seed('courses', [COURSE])
  control.seed('qrcodes', [{ _id: 'CODE1', status: 'unused', courseId: 'c1' }])
})

describe('activateCourse（一码一用·黄金 §一）', () => {
  it('大白话：空码/不存在的码拒', async () => {
    expect((await call('activateCourse', { code: '' })).error).toBe('INVALID_CODE')
    expect((await call('activateCourse', { code: 'NOPE' })).error).toBe('INVALID_CODE')
  })

  it('大白话：首扫抢占成功——码翻已激活记下激活者，建激活记录（未确认态）', async () => {
    const r = await call('activateCourse', { code: 'CODE1' })
    expect(r).toEqual({ ok: true, state: 'activated', courseId: 'c1' })
    const qr = control.dump('qrcodes')[0]
    expect(qr.status).toBe('activated')
    expect(qr.activatedBy).toBe('oME')
    const act = control.dump('activations')[0]
    expect(act._id).toBe('CODE1')
    expect(act.enteredAt).toBe(null)
  })

  it('大白话：本人重扫未确认码仍是已激活态、不重复建档；已确认后再扫识别为「我的课」', async () => {
    await call('activateCourse', { code: 'CODE1' })
    const r2 = await call('activateCourse', { code: 'CODE1' })
    expect(r2.state).toBe('activated')
    expect(control.dump('activations').length).toBe(1)

    await call('confirmEnter', { code: 'CODE1' })
    const r3 = await call('activateCourse', { code: 'CODE1' })
    expect(r3.state).toBe('mine')
  })

  it('大白话：他人扫已占用码拒并带回课程标识（「已被激活」屏按课程显图）', async () => {
    await call('activateCourse', { code: 'CODE1' })
    control.setOpenId('oOTHER')
    const r = await call('activateCourse', { code: 'CODE1' })
    expect(r.error).toBe('CODE_TAKEN')
    expect(r.courseId).toBe('c1')
  })

  it('大白话：半步失败自愈——码已翻但激活记录缺失时，本人重扫补回记录', async () => {
    control.seed('qrcodes', [{ _id: 'HALF', status: 'activated', courseId: 'c1', activatedBy: 'oME' }])
    const r = await call('activateCourse', { code: 'HALF' })
    expect(r.state).toBe('activated')
    expect(control.dump('activations').some((a: any) => a._id === 'HALF')).toBe(true)
  })

  it('大白话：老随机主键激活记录命中即复用、不重建（惰性迁移）', async () => {
    control.seed('qrcodes', [{ _id: 'OLD', status: 'activated', courseId: 'c1', activatedBy: 'oME' }])
    control.seed('activations', [{ _id: 'rand-xyz', _openid: 'oME', code: 'OLD', courseId: 'c1', enteredAt: 123 }])
    const r = await call('activateCourse', { code: 'OLD' })
    expect(r.state).toBe('mine')
    expect(control.dump('activations').filter((a: any) => a.code === 'OLD').length).toBe(1)
  })
})

describe('confirmEnter（退货权法律节点·黄金 §二）', () => {
  beforeEach(async () => {
    await call('activateCourse', { code: 'CODE1' })
  })

  it('大白话：未激活拒；首确认写进课时间，二次确认保留首次时间（幂等）', async () => {
    expect((await call('confirmEnter', { code: 'NOPE' })).error).toBe('NOT_ACTIVATED')
    const r1 = await call('confirmEnter', { code: 'CODE1' })
    expect(r1.enteredAt).toBeGreaterThan(0)
    const r2 = await call('confirmEnter', { code: 'CODE1' })
    expect(r2.enteredAt).toBe(r1.enteredAt)
  })

  it('大白话：首次进课失效退货权——最早一条可退的对应商品行翻不可退；覆盖已发货/已完成单', async () => {
    control.seed('products', [{ _id: 'p1', id: 'p1', courseId: 'c1' }])
    control.seed('orders', [
      {
        _id: 'o1',
        id: 'o1',
        _openid: 'oME',
        status: 'shipped',
        createdAt: 100,
        items: [{ productId: 'p1', qty: 1, refundable: true }],
      },
    ])
    const r = await call('confirmEnter', { code: 'CODE1' })
    expect(r.revoked).toEqual({ orderId: 'o1', lineId: 'p1', productId: 'p1' })
    const it0 = control.dump('orders')[0].items[0]
    expect(it0.refundable).toBe(false)
    expect(it0.enteredQty).toBe(1)
  })

  it('大白话：数量级进课——买 3 进 1 只记一件、整行仍可退；重复确认不多扣', async () => {
    control.seed('products', [{ _id: 'p1', id: 'p1', courseId: 'c1' }])
    control.seed('orders', [
      {
        _id: 'o1',
        id: 'o1',
        _openid: 'oME',
        status: 'paid',
        createdAt: 100,
        items: [{ productId: 'p1', qty: 3, refundable: true }],
      },
    ])
    await call('confirmEnter', { code: 'CODE1' })
    const it0 = control.dump('orders')[0].items[0]
    expect(it0.enteredQty).toBe(1)
    expect(it0.refundable).toBe(true) // 剩 2 件仍可退
    await call('confirmEnter', { code: 'CODE1' }) // 幂等：不再多扣
    expect(control.dump('orders')[0].items[0].enteredQty).toBe(1)
  })

  it('大白话：并发进课件数不少记（同课两码同时确认，两件都入账）', async () => {
    control.seed('qrcodes', [
      { _id: 'CODE1', status: 'unused', courseId: 'c1' },
      { _id: 'CODE2', status: 'unused', courseId: 'c1' },
    ])
    control.seed('activations', [])
    await call('activateCourse', { code: 'CODE1' })
    await call('activateCourse', { code: 'CODE2' })
    control.seed('products', [{ _id: 'p1', id: 'p1', courseId: 'c1' }])
    control.seed('orders', [
      {
        _id: 'o1',
        id: 'o1',
        _openid: 'oME',
        status: 'paid',
        createdAt: 100,
        items: [{ productId: 'p1', qty: 2, refundable: true }],
      },
    ])
    await Promise.all([call('confirmEnter', { code: 'CODE1' }), call('confirmEnter', { code: 'CODE2' })])
    const it0 = control.dump('orders')[0].items[0]
    expect(it0.enteredQty).toBe(2) // 并发不互覆盖少记（否则可多退一件的钱）
    expect(it0.refundable).toBe(false)
  })

  it('大白话：送礼场景——确认者名下无相关订单，正常确认、不失效任何退货权、不报错', async () => {
    const r = await call('confirmEnter', { code: 'CODE1' })
    expect(r.enteredAt).toBeGreaterThan(0)
    expect(r.revoked).toBe(null)
  })
})

describe('getCourses / getPlaybackUrl（目录不漏源·鉴权 fail-closed·黄金 §三）', () => {
  it('大白话：公开目录绝不下发视频源——整份响应无 videoFileId、残留免费标记不暴露，段只有 hasVideo', async () => {
    const r = await call('getCourses')
    const raw = JSON.stringify(r)
    expect(raw.includes('videoFileId')).toBe(false)
    expect(raw.includes('cloud://')).toBe(false)
    expect(raw.includes('"free"')).toBe(false)
    const segs = r.list[0].chapters[0].lessons[0].segments
    expect(segs[0].hasVideo).toBe(true)
    expect(segs[1].hasVideo).toBe(false)
  })

  it('大白话：未确认进课任何段都拒（只激活未确认也拒；残留免费标记不构成授权）', async () => {
    expect((await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's1' })).error).toBe('NOT_ENTITLED')
    await call('activateCourse', { code: 'CODE1' }) // 激活但未确认
    expect((await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's1' })).error).toBe('NOT_ENTITLED')
  })

  it('大白话：已确认进课放行短时地址；未剪段返回空地址不报错；课/段不存在各按错拒', async () => {
    await call('activateCourse', { code: 'CODE1' })
    await call('confirmEnter', { code: 'CODE1' })
    const r = await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's1' })
    expect(r.url).toBe('https://tmp/cloud://v/s1.mp4')
    expect((await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's2' })).url).toBe(null)
    expect((await call('getPlaybackUrl', { courseId: 'nope', segmentId: 's1' })).error).toBe('NO_COURSE')
    expect((await call('getPlaybackUrl', { courseId: 'c1', segmentId: 'nope' })).error).toBe('NO_SEGMENT')
  })
})

describe('getMyCourses / getMyProgress / trackEvent（黄金 §四/§五）', () => {
  it('大白话：我的课程只认已确认进课；同课多码去重取最早；他人的不返回', async () => {
    control.seed('activations', [
      { _id: 'a1', _openid: 'oME', courseId: 'c1', enteredAt: 200 },
      { _id: 'a2', _openid: 'oME', courseId: 'c1', enteredAt: 100 },
      { _id: 'a3', _openid: 'oME', courseId: 'c2', enteredAt: null },
      { _id: 'a4', _openid: 'oOTHER', courseId: 'c3', enteredAt: 50 },
    ])
    const r = await call('getMyCourses')
    expect(r.list).toEqual([{ courseId: 'c1', enteredAt: 100 }])
  })

  it('大白话：埋点缺类型拒、元数据超限拒；普通事件只记流水不折叠进度', async () => {
    expect((await call('trackEvent', {})).error).toBe('NO_TYPE')
    expect((await call('trackEvent', { type: 'x', meta: { blob: 'a'.repeat(2000) } })).error).toBe('META_TOO_BIG')
    await call('trackEvent', { type: 'page_view', page: 'home' })
    expect(control.dump('events').length).toBe(1)
    expect(control.dump('progress').length).toBe(0)
  })

  it('大白话：看完一段折叠进「每人每课一条」；同课第二段折叠同一条；进度只回本人', async () => {
    await call('activateCourse', { code: 'CODE1' })
    await call('confirmEnter', { code: 'CODE1' })
    await call('trackEvent', { type: 'segment_done', targetId: 's1', meta: { courseId: 'c1', lessonId: 'l1' } })
    await call('trackEvent', { type: 'segment_done', targetId: 's2', meta: { courseId: 'c1', lessonId: 'l1' } })
    const progress = control.dump('progress')
    expect(progress.length).toBe(1)
    expect(progress[0].done.s1).toBe(true)
    expect(progress[0].done.s2).toBe(true)
    expect(progress[0].last.segmentId).toBe('s2')
    const mine = await call('getMyProgress')
    expect(mine.list.length).toBe(1)
  })

  it('大白话：防刷——未确认进课的进度事件不折叠（流水仍记，供分析）', async () => {
    await call('trackEvent', { type: 'segment_done', targetId: 's1', meta: { courseId: 'c1' } })
    expect(control.dump('events').length).toBe(1)
    expect(control.dump('progress').length).toBe(0)
  })
})
