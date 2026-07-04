// 黄金 admin-misc §二（上新流水线/软下架/孤儿视频回收/分片/批次）（守卫 rw-admin2-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const DRAFT = {
  id: 'p1',
  name: '小鸭礼盒',
  price: '198',
  cover: 'cloud://c/p1.png',
  skus: [{ name: '基础款', price: '198' }],
}

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('商品草稿与上架（黄金：白名单/四道门/软下架不隐式复活）', () => {
  it('大白话：草稿白名单清洗——非白名单字段丢弃、超长截断、落库筹备中', async () => {
    const r = await post('saveDraft', { product: { ...DRAFT, hack: '注入', name: '名'.repeat(99) } })
    expect(r.ok).toBe(true)
    const d = control.dump('productsDraft')[0]
    expect(d.hack).toBeUndefined()
    expect(d.name.length).toBe(60)
    expect(d.status).toBe('preparing')
  })

  it('大白话：上架四道门——无草稿/缺封面/坏价/缺 SKU 分别拒；齐全成功转在售、首发默认上首页', async () => {
    expect((await post('publishProduct', { id: 'ghost' })).error).toBe('NO_DRAFT')
    await post('saveDraft', { product: { ...DRAFT, cover: '' } })
    expect((await post('publishProduct', { id: 'p1' })).error).toBe('NEED_COVER')
    await post('saveDraft', { product: { ...DRAFT, price: '-5' } })
    expect((await post('publishProduct', { id: 'p1' })).error).toBe('NEED_INFO')
    await post('saveDraft', { product: { ...DRAFT, skus: [] } })
    expect((await post('publishProduct', { id: 'p1' })).error).toBe('NEED_SKUS')

    await post('saveDraft', { product: DRAFT })
    expect((await post('publishProduct', { id: 'p1' })).ok).toBe(true)
    const p = control.dump('products')[0]
    expect(p.price).toBe(198) // 字符串价转数字
    expect(p.featured).toBe(true)
    expect(control.dump('productsDraft')[0].status).toBe('onsale')
  })

  it('大白话：停售可恢复不丢记录；编辑重发不隐式复活——须显式恢复销售；操作不存在商品报无此商品', async () => {
    await post('saveDraft', { product: DRAFT })
    await post('publishProduct', { id: 'p1' })
    expect((await post('unpublishProduct', { id: 'p1' })).ok).toBe(true)
    expect(control.dump('products')[0].listed).toBe(false)

    await post('publishProduct', { id: 'p1' }) // 编辑重发
    expect(control.dump('products')[0].listed).toBe(false) // 仍停售·不隐式复活

    expect((await post('republishProduct', { id: 'p1' })).ok).toBe(true)
    expect(control.dump('products')[0].listed).toBe(true)
    expect((await post('unpublishProduct', { id: 'ghost' })).error).toBe('NO_PRODUCT')
  })

  it('大白话：删除诚实——草稿与已上架记录一并删、两处都查不到；草稿列表带上架三态映射', async () => {
    await post('saveDraft', { product: DRAFT })
    await post('publishProduct', { id: 'p1' })
    await post('unpublishProduct', { id: 'p1' })
    const list = await post('listDrafts')
    expect(list.listed.p1).toBe(false) // 已下架态显形

    await post('deleteDraft', { id: 'p1' })
    expect(control.dump('productsDraft').length).toBe(0)
    expect(control.dump('products').length).toBe(0)
  })
})

describe('课程发布与孤儿视频回收（黄金）', () => {
  it('大白话：无草稿拒；发布覆盖正式课程；旧发布不再引用的视频被回收、仍在用的不误删', async () => {
    expect((await post('publishCourse', { courseId: 'c1' })).error).toBe('NO_DRAFT')

    control.seed('courses', [
      {
        _id: 'c1',
        id: 'c1',
        title: '旧版',
        chapters: [
          { id: 'ch1', title: '章', lessons: [{ id: 'l1', name: '节', segments: [
            { id: 's1', name: '换掉的段', videoFileId: 'cloud://v/old.mp4' },
            { id: 's2', name: '保留的段', videoFileId: 'cloud://v/keep.mp4' },
          ] }] },
        ],
      },
    ])
    control.seed('coursesDraft', [
      {
        _id: 'c1',
        id: 'c1',
        title: '新版',
        chapters: [
          { id: 'ch1', title: '章', lessons: [{ id: 'l1', name: '节', dur: '', segments: [
            { id: 's1', name: '换掉的段', dur: '', videoFileId: 'cloud://v/new.mp4' },
            { id: 's2', name: '保留的段', dur: '', videoFileId: 'cloud://v/keep.mp4' },
          ] }] },
        ],
      },
    ])
    expect((await post('publishCourse', { courseId: 'c1' })).ok).toBe(true)
    expect(control.dump('courses').find((c: any) => c._id === 'c1').title).toBe('新版')
    const deleted = control.deletedFiles()
    expect(deleted).toContain('cloud://v/old.mp4') // 孤儿回收
    expect(deleted).not.toContain('cloud://v/keep.mp4') // 仍在用不误删
    expect(deleted).not.toContain('cloud://v/new.mp4')
  })
})

describe('分片上传（黄金：缺号拒·重组等字节·清理）', () => {
  it('大白话：坏分片拒；序号不连续（缺号）拒不拼损坏文件；正好覆盖才重组且分片清理', async () => {
    expect((await post('uploadChunk', { uploadId: 'u1', seq: -1, b64: 'x' })).error).toBe('BAD_CHUNK')

    await post('uploadChunk', { uploadId: 'u1', seq: 0, b64: 'AA' })
    await post('uploadChunk', { uploadId: 'u1', seq: 2, b64: 'CC' }) // 缺 1 号
    const miss = await post('uploadFinish', { uploadId: 'u1', total: 2, pid: 'p1' })
    expect(miss.error).toBe('CHUNKS_MISSING')

    await post('uploadChunk', { uploadId: 'u1', seq: 1, b64: 'BB' })
    const done = await post('uploadFinish', { uploadId: 'u1', total: 3, pid: 'p1' })
    expect(done.ok).toBe(true)
    expect(done.fileID).toContain('products/p1/')
    expect(control.dump('uploadChunks').length).toBe(0) // 拼完清理

    expect((await post('uploadFinish', { uploadId: 'u2', total: 999 })).error).toBe('BAD_FINISH') // 片数封顶
  })
})

describe('码批次（黄金：数量闸·聚合·分页全取）', () => {
  it('大白话：数量漏传/非法拒不静默成 1；成功透传批次与码；超大数量钳到上限', async () => {
    expect((await post('createBatch', { courseId: 'c1' })).error).toBe('BAD_ARGS')
    expect((await post('createBatch', { courseId: 'c1', count: 0 })).error).toBe('BAD_ARGS')

    control.setCallFunctionResult({ result: { ok: true, batchId: 'b1', codes: ['K1', 'K2'] } })
    const r = await post('createBatch', { courseId: 'c1', count: 9999 })
    expect(r.ok).toBe(true)
    expect(r.batchId).toBe('b1')
    const sent = control.callFunctionCalls()[0]
    expect(sent.name).toBe('genQrcodes')
    expect(sent.data.count).toBe(500) // 钳上限
  })

  it('大白话：批次聚合总数/已激活且不混别课；列码分页全取不被单页截断', async () => {
    const codes = Array.from({ length: 250 }, (_, i) => ({
      _id: 'K' + i,
      courseId: 'c1',
      batchId: i < 200 ? 'b1' : 'b2',
      status: i % 2 ? 'activated' : 'unused',
      createdAt: i,
    }))
    control.seed('qrcodes', [...codes, { _id: 'other', courseId: 'c2', batchId: 'bx', status: 'unused', createdAt: 1 }])
    const lb = await post('listBatches', { courseId: 'c1' })
    expect(lb.list.length).toBe(2)
    const b1 = lb.list.find((b: any) => b.batchId === 'b1')
    expect(b1.total).toBe(200)
    expect(b1.activated).toBe(100)

    const lc = await post('listBatchCodes', { batchId: 'b1' })
    expect(lc.codes.length).toBe(200) // 跨页取齐
  })
})
