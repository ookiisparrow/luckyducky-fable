// 后台内容写路径：预读失败 ≠ 空档/rev=0（根因#14）。
// 旧写法 .get().catch(() => null) 把库故障折成「没有这份」，接着覆盖或按空基线 GC。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const failGet = (coll: string, id?: string) => {
  control.setBeforeGet((args: any) => {
    if (args.coll !== coll) return
    if (id && args.id !== id) return
    throw new Error('MOCK_DB_FAIL')
  })
}

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})
afterEach(() => control.setBeforeGet(null as never))

describe('content：预读失败停写，真缺档仍当空', () => {
  it('大白话：首页/协议页/帮助视频——库挂了回 DOC_READ_FAIL，不装成空白；真没有文档仍 ok+空', async () => {
    expect((await post('getHomeContent')).home).toBeNull()
    expect((await post('getPageContent', { page: 'about' })).content).toBeNull()
    expect((await post('listHelpVideos')).items).toEqual([])

    failGet('content', 'home')
    expect(await post('getHomeContent')).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    control.setBeforeGet(null as never)
    failGet('content', 'about')
    expect(await post('getPageContent', { page: 'about' })).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    control.setBeforeGet(null as never)
    failGet('content', 'helpVideos')
    expect(await post('listHelpVideos')).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
  })

  it('大白话：帮助视频旧档读失败——不覆盖、不把旧视频当垃圾删', async () => {
    control.seed('content', [
      { _id: 'helpVideos', items: [{ id: 'h1', title: '旧', segments: [{ id: 's1', name: '段', videoFileId: 'cloud://old' }] }], rev: 3 },
    ])
    failGet('content', 'helpVideos')
    const r = await post('saveHelpVideos', {
      items: [{ id: 'h1', title: '新', segments: [{ id: 's1', name: '段', videoFileId: 'cloud://new' }] }],
      baseRev: 0,
    })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    const doc = control.dump('content').find((d: any) => d._id === 'helpVideos')
    expect(doc.items[0].segments[0].videoFileId).toBe('cloud://old')
    expect(doc.rev).toBe(3)
    expect(control.deletedFiles()).toEqual([])
  })

  it('大白话：协议页旧档读失败——history 不被当成空史重写', async () => {
    control.seed('content', [
      { _id: 'agreement', user: { version: '1.0', sections: [] }, privacy: { version: '1.0', sections: [] }, history: [{ part: 'user', version: '1.0' }], _v: 2 },
    ])
    failGet('content', 'agreement')
    const r = await post('savePageContent', { page: 'agreement', data: { user: { version: '9.0', sections: [] }, privacy: { version: '1.0', sections: [] } } })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    const doc = control.dump('content').find((d: any) => d._id === 'agreement')
    expect(doc.user.version).toBe('1.0')
    expect(doc.history).toEqual([{ part: 'user', version: '1.0' }])
    expect(doc._v).toBe(2)
  })
})

describe('cards：设置合并读失败不拿空对象盖掉', () => {
  it('大白话：设置/卡片——真没有仍空；库挂了回 DOC_READ_FAIL，不装成空白配置', async () => {
    expect((await post('getSettings')).settings).toEqual({})
    expect((await post('getCard', { productId: 'p1' })).card).toBeNull()
    failGet('adminConfig', 'settings')
    expect(await post('getSettings')).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    control.setBeforeGet(null as never)
    failGet('cards', 'card-p1')
    expect(await post('getCard', { productId: 'p1' })).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
  })

  it('大白话：设置已有前缀，读失败再保存——旧前缀还在，不会被空底合并抹掉', async () => {
    control.seed('adminConfig', [{ _id: 'settings', urlPrefix: 'https://keep.example/', alertWebhook: '' }])
    failGet('adminConfig', 'settings')
    const r = await post('saveSettings', { urlPrefix: 'https://wipe.example/' })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    const s = control.dump('adminConfig').find((d: any) => d._id === 'settings')
    expect(s.urlPrefix).toBe('https://keep.example/')
  })
})

describe('courses：草稿/发布预读失败不按 rev=0 覆盖、不拿空基线入队', () => {
  const draft = (title: string, rev?: number) => ({
    id: 'c1',
    title,
    sort: 0,
    chapters: [{ id: 'ch', title: '章', lessons: [{ id: 'l', name: '课', segments: [{ id: 's', name: '段', videoFileId: 'cloud://old-vid' }] }] }],
    ...(rev != null ? { rev } : {}),
  })

  it('大白话：草稿库挂了——getCourseDraft 不装成「没这课」；真两边都没有仍 course:null', async () => {
    expect((await post('getCourseDraft', { courseId: 'c1' })).course).toBeNull()
    control.seed('coursesDraft', [{ _id: 'c1', ...draft('旧稿', 4) }])
    failGet('coursesDraft', 'c1')
    expect(await post('getCourseDraft', { courseId: 'c1' })).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
  })

  it('大白话：保存草稿时旧稿读失败——标题/版本不动，不当 rev=0 盖掉', async () => {
    control.seed('coursesDraft', [{ _id: 'c1', ...draft('旧稿', 5) }])
    failGet('coursesDraft', 'c1')
    const r = await post('saveCourseDraft', { course: draft('新稿'), baseRev: 0 })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    const doc = control.dump('coursesDraft').find((d: any) => d._id === 'c1')
    expect(doc.title).toBe('旧稿')
    expect(doc.rev).toBe(5)
  })

  it('大白话：发布时旧发布档读失败——已发布视频不被覆写、不按空基线入 GC 队', async () => {
    control.seed('coursesDraft', [{ _id: 'c1', ...draft('新稿', 1) }])
    control.seed('courses', [{ _id: 'c1', ...draft('已发布', 1), pendingGc: [{ fileId: 'cloud://queued', deleteAfter: 9 }] }])
    failGet('courses', 'c1')
    const r = await post('publishCourse', { courseId: 'c1' })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    const pub = control.dump('courses').find((d: any) => d._id === 'c1')
    expect(pub.title).toBe('已发布')
    expect(pub.pendingGc).toEqual([{ fileId: 'cloud://queued', deleteAfter: 9 }])
  })

  it('大白话：同步转码读草稿失败——回 DOC_READ_FAIL 不是「没有草稿」，也不改版本', async () => {
    control.seed('coursesDraft', [{ _id: 'c1', ...draft('旧稿', 2) }])
    failGet('coursesDraft', 'c1')
    const r = await post('syncVodMedia', { courseId: 'c1' })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    expect(r.error).not.toBe('NO_DRAFT')
    expect(control.dump('coursesDraft').find((d: any) => d._id === 'c1').rev).toBe(2)
  })
})

describe('products：草稿/上架预读失败不按空档覆盖', () => {
  const product = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    name: '小鸭礼盒',
    price: '198',
    cover: 'cloud://c/cov.png',
    images: ['cloud://i/a.png', 'cloud://i/b.png'],
    skus: [{ name: '基础款', price: '198' }],
    ...over,
  })

  it('大白话：换图前旧草稿读失败——图册不被覆写成新的、也不拿空基线入队', async () => {
    control.seed('productsDraft', [{ _id: 'p1', ...product() }])
    failGet('productsDraft', 'p1')
    const r = await post('saveDraft', { product: product({ images: ['cloud://i/a.png'] }) })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    const d = control.dump('productsDraft').find((x: any) => x._id === 'p1')
    expect(d.images).toEqual(['cloud://i/a.png', 'cloud://i/b.png'])
    expect(d.pendingGc || []).toEqual([])
  })

  it('大白话：已停售商品上架时发布档读失败——不停售被当成首发复活', async () => {
    control.seed('productsDraft', [{ _id: 'p1', ...product({ status: 'onsale' }) }])
    control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭礼盒', listed: false, sort: 3, featured: false }])
    failGet('products', 'p1')
    const r = await post('publishProduct', { id: 'p1' })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    const pub = control.dump('products').find((d: any) => d._id === 'p1')
    expect(pub.listed).toBe(false)
    expect(pub.sort).toBe(3)
  })
})

describe('kb：整册扫描失败不假装替换成功', () => {
  it('大白话：旧条目扫描挂了——不回「已保存」，旧答案还在', async () => {
    control.seed('kb', [{ _id: 'faq-old', question: '旧问', answer: '旧答', category: 'other' }])
    failGet('kb')
    const r = await post('saveKb', { entries: [{ key: 'faq-new', question: '新问', answer: '新答', category: 'other', order: 0 }] })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    const keys = control.dump('kb').map((d: any) => d._id)
    expect(keys).toContain('faq-old')
  })
})
