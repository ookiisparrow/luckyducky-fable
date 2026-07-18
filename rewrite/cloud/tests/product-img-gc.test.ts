// 商品图册孤儿 GC（Phase 3 清零战役·批B）：商品换图/发布替换/删档时旧图文件的回收生命周期钉死。
// 安全规则（主脑裁决·products.ts 注释同源）：
//   规则1 cover 位文件永不删（createOrder 快照进订单行·删旧 cover=历史订单封面裂图）；
//   规则2 GC 判据只认 cover/images 字段的 fileID 精确差集，禁按存储文件夹列举（products/<pid>/ 前缀
//         被卡片图/首页内容/目录页共居复用）；
//   规则3 孤儿跨草稿+发布两档并集判定；
//   规则4 saveDraft/发布替换走 24h 缓期 pendingGc（对齐 courses.publishCourse·在场会话临时址 TTL 内不断图）；
//   规则5 deleteDraft 立即删图册（两档已删·pendingGc 无处安身），cover 仍豁免。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { main as adminApi } from '../src/functions/adminApi/index'
import { main as cleanupEvents } from '../src/functions/timers/cleanupEvents'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const draft = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: '小鸭礼盒',
  price: '198',
  cover: 'cloud://c/cov.png',
  images: [],
  skus: [{ name: '基础款', price: '198' }],
  ...over,
})

const gcOf = (id = 'p1') =>
  ((control.dump('productsDraft').find((d: any) => (d.id || d._id) === id) || {}).pendingGc || []).map((en: any) =>
    String(en.fileId)
  )

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('商品图册孤儿 GC（缓期 pendingGc·cover 永不删）', () => {
  it('① saveDraft 换图册：被撤且非 cover 的旧图进 drafts.pendingGc、不立即 deleteFile', async () => {
    await post('saveDraft', { product: draft({ images: ['cloud://i/a.png', 'cloud://i/b.png'] }) })
    await post('saveDraft', { product: draft({ images: ['cloud://i/a.png'] }) }) // 撤掉 b
    expect(gcOf()).toContain('cloud://i/b.png')
    expect(gcOf()).not.toContain('cloud://i/a.png') // 仍引用·不进队
    expect(control.deletedFiles()).toEqual([]) // 缓期·不立删
    const en = (control.dump('productsDraft')[0].pendingGc || []).find((e: any) => String(e.fileId) === 'cloud://i/b.png')
    expect(Number(en.deleteAfter)).toBeGreaterThan(Date.now())
  })

  it('② cover 换新：旧 cover 不进队、不删除（订单快照·规则1）', async () => {
    await post('saveDraft', { product: draft({ cover: 'cloud://c/cov1.png' }) })
    await post('saveDraft', { product: draft({ cover: 'cloud://c/cov2.png' }) })
    expect(gcOf()).not.toContain('cloud://c/cov1.png')
    expect(control.deletedFiles()).toEqual([])
  })

  it('③ 草稿撤图但发布档仍引用 → 不进队（单看一档=错·规则3）', async () => {
    await post('saveDraft', { product: draft({ images: ['cloud://i/a.png'] }) })
    expect((await post('publishProduct', { id: 'p1' })).ok).toBe(true) // 发布档引用 a
    await post('saveDraft', { product: draft({ images: [] }) }) // 草稿撤掉 a
    expect(gcOf()).not.toContain('cloud://i/a.png') // 发布档仍引用·不孤儿
    expect(control.deletedFiles()).toEqual([])
  })

  it('④ 发布替换：旧发布不再引用的图并集差进队（不立删·缓期）', async () => {
    await post('saveDraft', { product: draft({ images: ['cloud://i/a.png'] }) })
    await post('publishProduct', { id: 'p1' }) // 发布档 = [a]
    await post('saveDraft', { product: draft({ images: ['cloud://i/b.png'] }) }) // 草稿换成 b（发布档仍 a·不孤儿）
    expect(gcOf()).not.toContain('cloud://i/a.png')
    await post('publishProduct', { id: 'p1' }) // 发布 b·旧发布 a 不再被引用 → 进队
    expect(gcOf()).toContain('cloud://i/a.png')
    expect(control.deletedFiles()).toEqual([]) // 缓期
  })

  it('⑤a cleanupEvents 消费 drafts.pendingGc：到期删并出队、未到期留队', async () => {
    const now = Date.now()
    control.seed('productsDraft', [
      {
        _id: 'p9',
        id: 'p9',
        pendingGc: [
          { fileId: 'cloud://i/due.png', deleteAfter: now - 1000 },
          { fileId: 'cloud://i/soon.png', deleteAfter: now + 86400_000 },
        ],
      },
    ])
    const r: any = await cleanupEvents()
    expect(r.imageGc).toBe(1)
    expect(control.deletedFiles()).toContain('cloud://i/due.png')
    expect(control.deletedFiles()).not.toContain('cloud://i/soon.png')
    const left = control.dump('productsDraft')[0].pendingGc.map((en: any) => String(en.fileId))
    expect(left).toEqual(['cloud://i/soon.png'])
  })

  it('⑤b cleanupEvents 删失败留队下轮再试（fail-soft·镜像 courses）', async () => {
    const now = Date.now()
    control.seed('productsDraft', [{ _id: 'p9', id: 'p9', pendingGc: [{ fileId: 'cloud://i/due.png', deleteAfter: now - 1000 }] }])
    const orig = (cloud as any).deleteFile
    ;(cloud as any).deleteFile = () => Promise.reject(new Error('MOCK_DELETE_FAIL'))
    try {
      const r: any = await cleanupEvents()
      expect(r.imageGc).toBe(0)
    } finally {
      ;(cloud as any).deleteFile = orig // 精确还原（E13·不用 git checkout）
    }
    const left = control.dump('productsDraft')[0].pendingGc.map((en: any) => String(en.fileId))
    expect(left).toEqual(['cloud://i/due.png']) // 留队
  })

  it('⑥ deleteDraft：图册立即删、cover 豁免', async () => {
    await post('saveDraft', { product: draft({ images: ['cloud://i/a.png', 'cloud://i/b.png'] }) })
    await post('publishProduct', { id: 'p1' })
    const r = await post('deleteDraft', { id: 'p1' })
    expect(r.ok).toBe(true)
    expect(control.deletedFiles()).toContain('cloud://i/a.png')
    expect(control.deletedFiles()).toContain('cloud://i/b.png')
    expect(control.deletedFiles()).not.toContain('cloud://c/cov.png') // cover 豁免
    expect(control.dump('products').length).toBe(0)
    expect(control.dump('productsDraft').length).toBe(0)
  })

  it('⑥b deleteDraft 删图册失败 → notifyAlert(GC_DELETE_FAIL)+ok:false', async () => {
    await post('saveDraft', { product: draft({ images: ['cloud://i/a.png'] }) })
    await post('publishProduct', { id: 'p1' })
    const orig = (cloud as any).deleteFile
    ;(cloud as any).deleteFile = () => Promise.reject(new Error('MOCK_DELETE_FAIL'))
    let r: any
    try {
      r = await post('deleteDraft', { id: 'p1' })
    } finally {
      ;(cloud as any).deleteFile = orig
    }
    expect(r.ok).toBe(false)
    expect(r.error).toBe('GC_DELETE_FAIL')
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'GC_DELETE_FAIL')).toBe(true)
  })

  it('⑥c deleteDraft：已挂起（缓期未到期）的 pendingGc 孤儿随删档一并立即删、不随文档 remove 泄漏', async () => {
    // 序列：换图产生 pendingGc（b 未到期）→ 24h 内 deleteDraft。draft 文档是 pendingGc 唯一之家，
    // remove() 后队列消失；若 deleteDraft 只删「当前字段差集」，b 将无文档引用、无队列、永久漏在云存储。
    await post('saveDraft', { product: draft({ images: ['cloud://i/a.png', 'cloud://i/b.png'] }) })
    await post('saveDraft', { product: draft({ images: ['cloud://i/a.png'] }) }) // 撤 b → b 进 pendingGc（未到期）
    expect(gcOf()).toContain('cloud://i/b.png') // 前置：b 确在缓期队列
    const r = await post('deleteDraft', { id: 'p1' })
    expect(r.ok).toBe(true)
    expect(control.deletedFiles()).toContain('cloud://i/a.png') // 当前引用图
    expect(control.deletedFiles()).toContain('cloud://i/b.png') // 已挂起的缓期孤儿·不得随文档 remove 泄漏
    expect(control.deletedFiles()).not.toContain('cloud://c/cov.png') // cover 仍豁免
    expect(control.dump('productsDraft').length).toBe(0)
  })

  it('⑦ 源扫：GC 入参只来自 cover/images 字段差集，禁按存储文件夹列举', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../src/functions/adminApi/actions/products.ts'), 'utf8')
    // 禁：任何「列文件夹/前缀枚举」形态的存储 API 出现在商品图 GC 路径（会误删共居的卡片/首页/目录图）
    for (const banned of ['listDirectoryFiles', 'getFileList', 'listFiles', 'readdir', 'listBucket']) {
      expect(src).not.toContain(banned)
    }
    // 正：孤儿判据基于 cover/images 字段
    expect(src).toMatch(/diffOrphans/)
    expect(src).toMatch(/\.cover\b/)
    expect(src).toMatch(/\.images\b/)
  })
})
