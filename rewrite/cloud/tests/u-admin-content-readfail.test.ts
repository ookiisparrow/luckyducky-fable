// 后台内容写路径：读失败 ≠ 空档（根因#14）；无排序的 skip 翻页 ≠ 稳定全量（根因#7）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

const failGet = (coll: string, id: string) => {
  control.setBeforeGet((args: any) => {
    if (args.coll === coll && args.id === id) throw new Error('MOCK_DB_FAIL')
  })
}

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})
afterEach(() => control.setBeforeGet(null as never))

describe('deleteDraft：删前读档失败就停手', () => {
  it('大白话：发布档读失败——不删档、不删图（发布档的旧封面不会被当成普通图删掉，订单快照不断图）', async () => {
    control.seed('products', [{ _id: 'p1', id: 'p1', name: '小鸭', cover: 'cloud://c/old.png', images: [] }])
    control.seed('productsDraft', [
      { _id: 'p1', id: 'p1', name: '小鸭', cover: 'cloud://c/new.png', images: ['cloud://c/old.png', 'cloud://i/a.png'] },
    ])
    failGet('products', 'p1')
    const r = await post('deleteDraft', { id: 'p1' })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    expect(control.deletedFiles()).toEqual([])
    expect(control.dump('products').length).toBe(1)
    expect(control.dump('productsDraft').length).toBe(1)
  })

  it('大白话：草稿读失败——不删档，缓期回收队列不随草稿一起丢', async () => {
    control.seed('productsDraft', [
      { _id: 'p1', id: 'p1', cover: 'cloud://c/cov.png', images: [], pendingGc: [{ fileId: 'cloud://i/q.png', deleteAfter: Date.now() + 1e6 }] },
    ])
    failGet('productsDraft', 'p1')
    const r = await post('deleteDraft', { id: 'p1' })
    expect(r).toMatchObject({ ok: false, error: 'DOC_READ_FAIL' })
    expect(control.dump('productsDraft')[0].pendingGc).toHaveLength(1)
    expect(control.deletedFiles()).toEqual([])
  })
})

describe('saveCheckpoints：旧节点扫描失败不装成「已整课覆盖」', () => {
  it('大白话：扫旧节点挂了——回 GC_REMOVE_FAIL（带新 rev 供前端刷基线）并留痕，旧节点还在', async () => {
    control.seed('checkpoints', [{ _id: 'def:c4:old', type: 'def', courseId: 'c4', nodeId: 'old', title: '旧节点' }])
    control.setBeforeGet((args: any) => {
      if (args.coll === 'checkpoints' && args.filter && args.filter.type === 'def') throw new Error('MOCK_DB_FAIL')
    })
    const r = await post('saveCheckpoints', { courseId: 'c4', nodes: [{ nodeId: 'new', title: '新节点', order: 0 }] })
    expect(r).toMatchObject({ ok: false, error: 'GC_REMOVE_FAIL', rev: 1 })
    const ids = control.dump('checkpoints').map((d: any) => d._id)
    expect(ids).toContain('def:c4:new')
    expect(ids).toContain('def:c4:old')
    expect(control.dump('anomalies').some((a: any) => a.code === 'GC_REMOVE_FAIL')).toBe(true)
  })
})

describe('listBatches：跨页计数不漏不重', () => {
  it('大白话：服务端对没排序的查询不保证每页同一顺序——批次总数仍各自对得上', async () => {
    const pad = (i: number) => String(i).padStart(3, '0')
    control.seed('qrcodes', [
      ...Array.from({ length: 150 }, (_, i) => ({ _id: 'A' + pad(i), courseId: 'c1', batchId: 'b-a', status: 'unused', createdAt: 1 })),
      ...Array.from({ length: 100 }, (_, i) => ({ _id: 'B' + pad(i), courseId: 'c1', batchId: 'b-b', status: 'unused', createdAt: 2 })),
    ])
    // 模拟真 TCB：无 orderBy 时每次请求的返回顺序不作保证（这里让首页倒序、后页正序）
    const proto = Object.getPrototypeOf(getDb().collection('qrcodes'))
    const origGet = proto.get
    const spy = vi.spyOn(proto, 'get').mockImplementation(function (this: any) {
      if (this.coll === 'qrcodes' && !this._order) this._order = [{ field: '_id', dir: this._skip ? 'asc' : 'desc' }]
      return origGet.call(this)
    })
    let r: any
    try {
      r = await post('listBatches', { courseId: 'c1' })
    } finally {
      spy.mockRestore()
    }
    const total = (id: string) => r.list.find((b: any) => b.batchId === id)?.total
    expect(total('b-a')).toBe(150)
    expect(total('b-b')).toBe(100)
  })
})
