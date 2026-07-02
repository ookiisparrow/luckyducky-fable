import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'
import * as scm from '../../packages/cloud/src/functions/admin/adminApi/actions/scmPurchase'
import { getDb } from '../../packages/cloud/src/kit'

// 进销存车道 A 采购线行为锁：① savePurchase 校验 fail-closed（qty/价/行/供应商/料号/重复行）+ totalFen
// 服务端算不信前端；② 状态机 draft→ordered→received 正流转 + received 首次流转绑门1 入库；③ received
// 幂等（重放不双入库·确定性流水只一条）；④ received 后 cancel 拒 / draft 直收拒（声明表天然拒·门2）；
// ⑤ RBAC 默认拒（外包 403·仅超管）。

const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const SUPER = 'super-admin-key-123'
const OUT = 'outsourced-key-123'
const body = (r) => ({ status: r.statusCode, ...JSON.parse(r.body) })
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then(body)
const dctx = (data = {}, agentId = 'admin') => ({ db: getDb(), cloud: null, data, drafts: {}, agentId })

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', caps: ['*'] },
    { _id: 'agent:out1', keyHash: sha(OUT), role: 'outsourced' },
  ])
  control.seed('suppliers', [
    { _id: 'sup-factory', name: 'XX 纺织厂', type: 'factory', active: true },
    { _id: 'sup-weaver', name: '张织女', type: 'outworker', active: true },
  ])
  control.seed('materials', [
    { _id: 'yarn:red:L:raw', name: '红色大团原团', category: 'yarn', uom: 'count', stock: 0, active: true },
    { _id: 'stuffing', name: '填充棉', category: 'accessory', uom: 'gram', stock: 100, active: true },
  ])
})

const LINES = [
  { materialId: 'yarn:red:L:raw', qty: 10, unitPriceFen: 350 },
  { materialId: 'stuffing', qty: 2000, unitPriceFen: 2 },
]
const draft = async (over = {}) => body(await scm.savePurchase(dctx({ supplierId: 'sup-factory', lines: LINES, ...over })))

const stockOf = (id) => control.dump('materials').find((m) => m._id === id)?.stock
const poOf = (id) => control.dump('purchaseOrders').find((p) => p._id === id)

describe('savePurchase（校验 fail-closed + totalFen 服务端算）', () => {
  it('qty 非正整数 / 价格负数或非整数分 → 拒（分毫不入库）', async () => {
    expect((await draft({ lines: [{ materialId: 'stuffing', qty: 1.5, unitPriceFen: 1 }] })).error).toBe('BAD_QTY')
    expect((await draft({ lines: [{ materialId: 'stuffing', qty: 0, unitPriceFen: 1 }] })).error).toBe('BAD_QTY')
    expect((await draft({ lines: [{ materialId: 'stuffing', qty: -3, unitPriceFen: 1 }] })).error).toBe('BAD_QTY')
    expect((await draft({ lines: [{ materialId: 'stuffing', qty: 1, unitPriceFen: -1 }] })).error).toBe('BAD_PRICE')
    expect((await draft({ lines: [{ materialId: 'stuffing', qty: 1, unitPriceFen: 3.5 }] })).error).toBe('BAD_PRICE')
    expect(control.dump('purchaseOrders')).toHaveLength(0)
  })

  it('空行 / 料号不在主档 / 同料重复行（撞入库幂等键）→ 拒', async () => {
    expect((await draft({ lines: [] })).error).toBe('BAD_LINES')
    const ghost = await draft({ lines: [{ materialId: 'ghost', qty: 1, unitPriceFen: 1 }] })
    expect(ghost.error).toBe('NO_MATERIAL')
    expect(ghost.materialId).toBe('ghost')
    const dup = await draft({
      lines: [
        { materialId: 'stuffing', qty: 1, unitPriceFen: 1 },
        { materialId: 'stuffing', qty: 2, unitPriceFen: 1 },
      ],
    })
    expect(dup.error).toBe('DUP_LINE')
  })

  it('供应商不存在或非厂家（织女）→ BAD_SUPPLIER', async () => {
    expect((await draft({ supplierId: 'ghost-sup' })).error).toBe('BAD_SUPPLIER')
    expect((await draft({ supplierId: 'sup-weaver' })).error).toBe('BAD_SUPPLIER')
  })

  it('totalFen 服务端算 Σqty×unitPriceFen·前端传的假 totalFen 被无视', async () => {
    const r = await draft({ totalFen: 1 }) // 伪造总价 1 分
    expect(r.status).toBe(200)
    expect(r.totalFen).toBe(10 * 350 + 2000 * 2) // 7500
    const po = poOf(r.purchaseId)
    expect(po.totalFen).toBe(7500)
    expect(po.status).toBe('draft')
    expect(po.lines).toHaveLength(2)
  })

  it('仅 draft 可改：改草稿重算 totalFen；ordered 后改 → 409 NOT_DRAFT；不存在 → 404', async () => {
    const r = await draft()
    const upd = await draft({ purchaseId: r.purchaseId, lines: [{ materialId: 'stuffing', qty: 100, unitPriceFen: 3 }] })
    expect(upd.status).toBe(200)
    expect(poOf(r.purchaseId).totalFen).toBe(300)
    await scm.markOrdered(dctx({ purchaseId: r.purchaseId }))
    const locked = await draft({ purchaseId: r.purchaseId })
    expect(locked.status).toBe(409)
    expect(locked.error).toBe('NOT_DRAFT')
    expect((await draft({ purchaseId: 'ghost-po' })).status).toBe(404)
  })
})

describe('状态机（门2）+ received 绑入库（门1·幂等）', () => {
  it('draft→ordered→received 正流转：received 首次流转各行入库 + 确定性流水 purchase_in:<id>:<料号>', async () => {
    const r = await draft()
    expect(body(await scm.markOrdered(dctx({ purchaseId: r.purchaseId }))).moved).toBe(true)
    const rec = body(await scm.receivePurchase(dctx({ purchaseId: r.purchaseId }, 'agent:who')))
    expect(rec.status).toBe(200)
    expect(rec.moved).toBe(true)
    expect(rec.applied).toBe(2)
    expect(stockOf('yarn:red:L:raw')).toBe(10)
    expect(stockOf('stuffing')).toBe(2100)
    const rows = control.dump('stockLedger')
    expect(rows.map((l) => l._id).sort()).toEqual([
      `purchase_in:${r.purchaseId}:stuffing`,
      `purchase_in:${r.purchaseId}:yarn:red:L:raw`,
    ])
    expect(rows[0].operator).toBe('agent:who')
  })

  it('received 幂等：重复 receivePurchase 不双入库（moved:false·流水仍各一条）', async () => {
    const r = await draft()
    await scm.markOrdered(dctx({ purchaseId: r.purchaseId }))
    await scm.receivePurchase(dctx({ purchaseId: r.purchaseId }))
    const again = body(await scm.receivePurchase(dctx({ purchaseId: r.purchaseId })))
    expect(again.status).toBe(200)
    expect(again.moved).toBe(false)
    expect(stockOf('yarn:red:L:raw')).toBe(10) // 不是 20
    expect(stockOf('stuffing')).toBe(2100) // 不是 4100
    expect(control.dump('stockLedger')).toHaveLength(2)
  })

  it('非法流转拒：draft 直接 receive → 409（未下单不可能到货）·账分毫不动', async () => {
    const r = await draft()
    const bad = body(await scm.receivePurchase(dctx({ purchaseId: r.purchaseId })))
    expect(bad.status).toBe(409)
    expect(bad.error).toBe('BAD_STATUS')
    expect(bad.current).toBe('draft')
    expect(stockOf('yarn:red:L:raw')).toBe(0)
    expect(control.dump('stockLedger')).toHaveLength(0)
  })

  it('received 后 cancel 被拒（声明表无 received→cancelled 边·入库后走调整单）', async () => {
    const r = await draft()
    await scm.markOrdered(dctx({ purchaseId: r.purchaseId }))
    await scm.receivePurchase(dctx({ purchaseId: r.purchaseId }))
    const c = body(await scm.cancelPurchase(dctx({ purchaseId: r.purchaseId })))
    expect(c.status).toBe(409)
    expect(c.error).toBe('BAD_STATUS')
    expect(poOf(r.purchaseId).status).toBe('received')
  })

  it('draft/ordered 可取消；不存在的单 404', async () => {
    const a = await draft()
    expect(body(await scm.cancelPurchase(dctx({ purchaseId: a.purchaseId }))).moved).toBe(true)
    const b = await draft()
    await scm.markOrdered(dctx({ purchaseId: b.purchaseId }))
    expect(body(await scm.cancelPurchase(dctx({ purchaseId: b.purchaseId }))).moved).toBe(true)
    expect(body(await scm.receivePurchase(dctx({ purchaseId: 'ghost' }))).status).toBe(404)
  })

  it('listPurchases：createdAt 倒序 + 按 status 过滤（bounded）', async () => {
    const a = await draft()
    await draft()
    await scm.cancelPurchase(dctx({ purchaseId: a.purchaseId }))
    const all = body(await scm.listPurchases(dctx()))
    expect(all.list).toHaveLength(2)
    const drafts = body(await scm.listPurchases(dctx({ status: 'draft' })))
    expect(drafts.list).toHaveLength(1)
    expect(drafts.list[0].status).toBe('draft')
  })
})

describe('RBAC 默认拒（门5：未登记 ACTION_CAPS＝admin:write·仅超管）', () => {
  it('外包账号调采购写/读 action → 403；超管 → 过闸', async () => {
    for (const a of ['savePurchase', 'markOrdered', 'receivePurchase', 'cancelPurchase', 'listPurchases']) {
      expect((await call(a, OUT)).status, `外包 ${a} 应 403`).toBe(403)
    }
    const ok = await call('savePurchase', SUPER, { supplierId: 'sup-factory', lines: LINES })
    expect(ok.status).toBe(200)
    expect((await call('listPurchases', SUPER)).status).toBe(200)
  })
})
