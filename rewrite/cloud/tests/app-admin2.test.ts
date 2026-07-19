// 黄金 admin-misc §二（上新流水线/软下架/孤儿视频回收/分片/批次）（守卫 rw-admin2-golden）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

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

  it('大白话：删除失败不静默——products 删失败即 ok:false 且不继续删 drafts（可重试）；两步都成功才真删净', async () => {
    await post('saveDraft', { product: DRAFT })
    await post('publishProduct', { id: 'p1' })
    // 注入 products 那一步 remove 失败（模拟真机偶发写失败）——spy 挂在共享 DocRef 原型上（同 throttle.test.ts 范式）
    const docProto = Object.getPrototypeOf(getDb().collection('products').doc('p1'))
    const spy = vi.spyOn(docProto, 'remove').mockImplementationOnce(() => Promise.reject(new Error('MOCK_REMOVE_FAIL')))
    // try/finally（I3·防线）：post 若抛异常，finally 仍保证 spy.mockRestore()——spy 挂在共享 DocRef 原型上，
    // 裸写「await post()→mockRestore()」中途一抛就残留，污染后续用例。
    let r: any
    try {
      r = await post('deleteDraft', { id: 'p1' })
    } finally {
      spy.mockRestore()
    }
    expect(r.ok).toBe(false) // 原代码两处 .catch(()=>{}) 全吞会恒回 ok:true——前端误显「已删除」
    expect(r.error).toBe('REMOVE_FAIL')
    expect(control.dump('products').length).toBe(1) // products 真失败·未被静默吞成「已删」
    expect(control.dump('productsDraft').length).toBe(1) // 顺序反转：products 未删成功·不继续删 drafts（留可重试）
    // 真留痕（病根14）
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'REMOVE_FAIL')).toBe(true)
    // 重试：两步都成功才真删净
    const ok = await post('deleteDraft', { id: 'p1' })
    expect(ok.ok).toBe(true)
    expect(control.dump('products').length).toBe(0)
    expect(control.dump('productsDraft').length).toBe(0)
  })

  it('大白话：listDrafts 派生 6 步分步态（换皮误判「无源」）——卡片定稿/课程有视频/该课有批次 各由 cards/courses/qrcodes bounded join 得；无则不误报', async () => {
    await post('saveDraft', { product: DRAFT }) // p1·courseId 缺→course-p1
    control.seed('cards', [{ _id: 'card-p1', productId: 'p1', status: 'final' }])
    control.seed('courses', [{ _id: 'course-p1', id: 'course-p1', chapters: [{ lessons: [{ segments: [{ videoFileId: 'cloud://v.mp4' }] }] }] }])
    control.seed('qrcodes', [{ _id: 'q1', courseId: 'course-p1', batchId: 'b1', status: 'unused', createdAt: 1 }])
    const r = await post('listDrafts')
    expect(r.cardFinal.p1).toBe(true) // 卡片定稿
    expect(r.hasVideo['course-p1']).toBe(true) // 课程有视频段
    expect(r.hasBatch['course-p1']).toBe(true) // 该课有码批次（aggregate group·不扫全表）
    // 无卡片/视频/批次的产品：各态不误报完成
    await post('saveDraft', { product: { id: 'p2', name: '空', price: '1', cover: 'x', skus: [] } })
    const r2 = await post('listDrafts')
    expect(r2.cardFinal.p2).toBeFalsy()
    expect(r2.hasVideo['course-p2']).toBeFalsy()
    expect(r2.hasBatch['course-p2']).toBeFalsy()
  })
})

describe('productId/spec 出生点校验（战役3 批D·D1·shared/scmKey.ts 单源）：saveDraft 拒歧义 __ 组合、正常商品照常', () => {
  it('大白话：id 含 __ 或以 _ 结尾拒 BAD_SPEC；tag/SKU 名含 __ 同样拒；正常商品不受影响', async () => {
    expect((await post('saveDraft', { product: { ...DRAFT, id: 'p__x' } })).error).toBe('BAD_SPEC') // productId 含 __
    expect((await post('saveDraft', { product: { ...DRAFT, id: 'p_' } })).error).toBe('BAD_SPEC') // productId 尾随 _
    expect((await post('saveDraft', { product: { ...DRAFT, tag: 'a__b' } })).error).toBe('BAD_SPEC') // tag 会当 spec 用（无 SKU 选择时）
    expect((await post('saveDraft', { product: { ...DRAFT, skus: [{ name: 'x__y', price: '1' }] } })).error).toBe('BAD_SPEC') // SKU 名含 __
    // 正常商品（含合法单下划线的 id/tag/SKU 名）照常保存
    const ok = await post('saveDraft', { product: { ...DRAFT, id: 'p_ok', tag: '_红', skus: [{ name: '基础_款', price: '198' }] } })
    expect(ok.ok).toBe(true)
  })

  it('大白话：存量歧义值（校验上线前的历史数据）不追溯——仅改无关字段（价格）仍保存成功；改成新的歧义值才拦', async () => {
    // 直接建库模拟「校验上线前」已存在的歧义 tag/SKU 名（跳过 API 走 seed，代表历史存量数据）
    control.seed('productsDraft', [
      { _id: 'p_legacy', id: 'p_legacy', name: '历史遗留', price: '100', cover: 'cloud://c/x.png', tag: 'a__b', skus: [{ name: 'x__y', price: '100' }], status: 'preparing' },
    ])
    // 仅改价格、id/tag/SKU 名原样带回——存量歧义值沿用旧值放行
    const keepOk = await post('saveDraft', {
      product: { id: 'p_legacy', name: '历史遗留', price: '150', cover: 'cloud://c/x.png', tag: 'a__b', skus: [{ name: 'x__y', price: '150' }] },
    })
    expect(keepOk.ok).toBe(true)
    expect(control.dump('productsDraft').find((d: any) => d.id === 'p_legacy').price).toBe('150')
    // 把 tag 改成新的歧义值——新增出生的歧义值仍拦
    const tagBad = await post('saveDraft', {
      product: { id: 'p_legacy', name: '历史遗留', price: '150', cover: 'cloud://c/x.png', tag: 'c__d', skus: [{ name: 'x__y', price: '150' }] },
    })
    expect(tagBad.error).toBe('BAD_SPEC')
    // 把 SKU 名改成新的歧义值——同样拦
    const skuBad = await post('saveDraft', {
      product: { id: 'p_legacy', name: '历史遗留', price: '150', cover: 'cloud://c/x.png', tag: 'a__b', skus: [{ name: 'm__n', price: '150' }] },
    })
    expect(skuBad.error).toBe('BAD_SPEC')
  })
})

describe('橱窗排序保存（saveShowcase·根因#14 部分失败不静默）', () => {
  it('大白话：全部成功回 ok:true；任一条 update 失败不再被 .catch(()=>{}) 静默吞掉——回 ok:false 报失败数，不误显"已保存"', async () => {
    await post('saveDraft', { product: DRAFT })
    await post('publishProduct', { id: 'p1' })
    await post('saveDraft', { product: { ...DRAFT, id: 'p2', cover: 'cloud://c/p2.png' } })
    await post('publishProduct', { id: 'p2' })

    const ok = await post('saveShowcase', { items: [{ id: 'p1', sort: 1, featured: true }, { id: 'p2', sort: 2, featured: false }] })
    expect(ok.ok).toBe(true)
    expect(control.dump('products').find((p: any) => p._id === 'p1').sort).toBe(1)

    // 注入第 2 条 update 失败（模拟真机偶发写失败·如网络抖动/数据库限流）
    let calls = 0
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === 'products') {
        calls++
        if (calls === 2) throw new Error('MOCK_UPDATE_FAIL')
      }
    })
    const r = await post('saveShowcase', { items: [{ id: 'p1', sort: 3, featured: true }, { id: 'p2', sort: 4, featured: false }] })
    control.setBeforeUpdate(null as never)
    expect(r.ok).toBe(false) // 原代码 .catch(()=>{}) 吞错会回 ok:true——前端永远「已保存」的假象
    expect(String(r.error)).toContain('PARTIAL_WRITE')
    // 真留痕（P2·bug sweep Round2 复审补漏）：不能只打裸 alert()（只一行 console.error·admin 查不到）——
    // 须真落 anomalies 账本（同 app-learning.test.ts 的 ACT_PERSIST_UNVERIFIED 断言范式）。
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'PARTIAL_WRITE')).toBe(true)
  })
})

describe('课程发布与孤儿视频回收（黄金·缓期 GC）', () => {
  it('大白话：无草稿拒；发布覆盖正式课程；旧发布不再引用的视频入缓期回收队列（不立删——在播学员手里的旧地址还要用）、仍在用的不入队', async () => {
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
    const pub = control.dump('courses').find((c: any) => c._id === 'c1')
    expect(pub.title).toBe('新版')
    // 缓期契约（课程链路审计 2026-07-17）：发布那刻不物理删（正在播旧段的学员持有旧文件签名 URL·立删即播放中途 404）；
    // 孤儿进 pendingGc 队列（带 deleteAfter），到期由 cleanupEvents 定时器真删（见 course-chain-hardening.test.ts）。
    expect(control.deletedFiles()).toEqual([]) // 发布同步零物理删除
    const queue = (pub.pendingGc || []).map((en: any) => en.fileId)
    expect(queue).toContain('cloud://v/old.mp4') // 孤儿入队
    expect(queue).not.toContain('cloud://v/keep.mp4') // 仍在用不入队
    expect(queue).not.toContain('cloud://v/new.mp4')
    expect((pub.pendingGc || []).every((en: any) => en.deleteAfter > Date.now())).toBe(true) // 缓期在未来
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
