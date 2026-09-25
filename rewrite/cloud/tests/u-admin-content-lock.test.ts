// 后台内容 action 的既有行为锁：set 失败回退 add、批次号/建批校验、课程发布 GC 队列承接、停售/恢复、节点元档读失败。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { makeBatchId } from '../src/functions/adminApi/actions/batches'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const failSet = (coll: string, id: string) =>
  control.setBeforeUpdate((a: any) => {
    if (a.coll === coll && a.id === id) throw new Error('MOCK_SET_FAIL')
  })

const DRAFT = { id: 'p1', name: '小鸭礼盒', price: '198', cover: 'cloud://c/p1.png', skus: [{ name: '基础款', price: '198' }] }

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('整档写：doc.set 失败就回退 add（同一 _id）', () => {
  const cases: [string, Record<string, unknown>, string, string, (d: any) => unknown, unknown, () => void][] = [
    ['saveHomeContent', { home: { hero: { title: 'T' } } }, 'content', 'home', (d) => d.hero.title, 'T', () => {}],
    ['savePageContent', { page: 'about', data: { lead: 'L' } }, 'content', 'about', (d) => d.lead, 'L', () => {}],
    ['saveHelpVideos', { items: [{ title: 'H' }] }, 'content', 'helpVideos', (d) => d.items[0].title, 'H', () => {}],
    ['saveDraft', { product: DRAFT }, 'productsDraft', 'p1', (d) => d.name, '小鸭礼盒', () => {}],
    ['publishProduct', { id: 'p1' }, 'products', 'p1', (d) => d.price, 198, () => control.seed('productsDraft', [{ _id: 'p1', ...DRAFT }])],
    ['saveCourseDraft', { course: { id: 'c9', title: '课' } }, 'coursesDraft', 'c9', (d) => d.rev, 1, () => {}],
    ['publishCourse', { courseId: 'c1' }, 'courses', 'c1', (d) => d.title, '课', () => control.seed('coursesDraft', [{ _id: 'c1', id: 'c1', title: '课', chapters: [] }])],
    ['saveSettings', { urlPrefix: 'https://x' }, 'adminConfig', 'settings', (d) => d.urlPrefix, 'https://x', () => {}],
    ['saveCard', { card: { productId: 'p1', name: '卡' } }, 'cards', 'card-p1', (d) => d.name, '卡', () => {}],
  ]
  for (const [action, data, coll, id, pick, want, setup] of cases) {
    it(`大白话：${action} 的 set 挂了——改用 add 落到 ${coll}/${id}，照样报成功`, async () => {
      setup()
      failSet(coll, id)
      const r = await post(action, data)
      control.setBeforeUpdate(null)
      expect(r.ok).toBe(true)
      const doc = control.dump(coll).find((d: any) => d._id === id)
      expect(pick(doc)).toBe(want)
    })
  }

  it('大白话：set 和 add 都失败——报错不装成功，旧档原样', async () => {
    control.seed('content', [{ _id: 'home', hero: { title: '旧' } }])
    failSet('content', 'home')
    const r = await post('saveHomeContent', { home: { hero: { title: '新' } } })
    control.setBeforeUpdate(null)
    expect(r.status).toBe(500)
    expect(control.dump('content').find((d: any) => d._id === 'home').hero.title).toBe('旧')
  })
})

describe('批次', () => {
  it('大白话：批次号时间段是北京时间 yyyyMMddHHmmss（跨年也对）', () => {
    expect(makeBatchId('c1', Date.UTC(2026, 8, 25, 4, 34, 56))).toMatch(/^b-c1-20260925123456-[0-9a-f]{6}$/)
    expect(makeBatchId('c1', Date.UTC(2025, 11, 31, 16, 0, 0))).toMatch(/^b-c1-20260101000000-[0-9a-f]{6}$/)
    expect(makeBatchId('c1', Date.UTC(2026, 0, 5, 1, 2, 3))).toMatch(/^b-c1-20260105090203-[0-9a-f]{6}$/)
  })

  it('大白话：建批——缺课号/坏数量拒 BAD_ARGS，课不存在报 UNKNOWN_COURSE，字符串数量照常生效', async () => {
    expect(await post('createBatch', { count: 3 })).toMatchObject({ status: 400, error: 'BAD_ARGS' })
    expect(await post('createBatch', { courseId: 'c1', count: 'abc' })).toMatchObject({ status: 400, error: 'BAD_ARGS' })
    expect(await post('createBatch', { courseId: 'cx', count: 3 })).toMatchObject({ status: 400, error: 'UNKNOWN_COURSE:cx' })
    control.seed('courses', [{ _id: 'c1', title: '课' }])
    const r = await post('createBatch', { courseId: 'c1', count: '3' })
    expect(r.ok).toBe(true)
    expect(r.codes).toHaveLength(3)
  })
})

describe('课程发布：孤儿视频队列承接', () => {
  it('大白话：旧队列里重新被引用的出队、其余原样保留期限；新孤儿入队且不重复', async () => {
    const seg = (id: string) => ({ id, name: id, dur: '', videoFileId: `cloud://v/${id}.mp4` })
    const course = (ids: string[], extra: Record<string, unknown> = {}) => ({
      _id: 'c1',
      id: 'c1',
      title: '课',
      chapters: [{ id: 'ch', title: '章', lessons: [{ id: 'l', name: '节', dur: '', segments: ids.map(seg) }] }],
      ...extra,
    })
    control.seed('courses', [
      course(['old', 'keep', 'q1'], {
        pendingGc: [
          { fileId: 'cloud://v/q1.mp4', deleteAfter: 111 },
          { fileId: 'cloud://v/back.mp4', deleteAfter: 222 },
        ],
      }),
    ])
    control.seed('coursesDraft', [course(['keep', 'back', 'new'])])
    const before = Date.now()
    expect((await post('publishCourse', { courseId: 'c1' })).ok).toBe(true)
    const q = control.dump('courses')[0].pendingGc
    expect(q.map((e: any) => e.fileId)).toEqual(['cloud://v/q1.mp4', 'cloud://v/old.mp4'])
    expect(q[0].deleteAfter).toBe(111)
    expect(q[1].deleteAfter).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000)
  })
})

describe('停售/恢复', () => {
  it('大白话：缺 id 拒 NO_ID；不存在的商品两边都报 NO_PRODUCT；停售记时间、恢复清时间', async () => {
    expect(await post('unpublishProduct', {})).toMatchObject({ status: 400, error: 'NO_ID' })
    expect(await post('republishProduct', {})).toMatchObject({ status: 400, error: 'NO_ID' })
    expect(await post('republishProduct', { id: 'ghost' })).toMatchObject({ status: 400, error: 'NO_PRODUCT' })
    control.seed('products', [{ _id: 'p1', id: 'p1', listed: true }])
    expect((await post('unpublishProduct', { id: 'p1' })).ok).toBe(true)
    expect(typeof control.dump('products')[0].unlistedAt).toBe('number')
    expect((await post('republishProduct', { id: 'p1' })).ok).toBe(true)
    expect(control.dump('products')[0]).toMatchObject({ listed: true, unlistedAt: null })
  })
})

describe('节点列表', () => {
  it('大白话：元档读失败只把 rev 当 0，节点列表照常返回', async () => {
    control.seed('checkpoints', [
      { _id: 'def:c1:n1', type: 'def', courseId: 'c1', nodeId: 'n1', title: '节点', order: 0 },
      { _id: 'defmeta:c1', type: 'defmeta', courseId: 'c1', rev: 5 },
    ])
    expect(await post('listCheckpoints', { courseId: 'c1' })).toMatchObject({ ok: true, rev: 5 })
    control.setBeforeGet((a: any) => {
      if (a.coll === 'checkpoints' && a.id === 'defmeta:c1') throw new Error('MOCK_DB_FAIL')
    })
    const r = await post('listCheckpoints', { courseId: 'c1' })
    control.setBeforeGet(null as never)
    expect(r).toMatchObject({ ok: true, rev: 0 })
    expect(r.list.map((n: any) => n.nodeId)).toEqual(['n1'])
  })
})
