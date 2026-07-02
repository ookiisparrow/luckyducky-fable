import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'
import * as scm from '../../packages/cloud/src/functions/admin/adminApi/actions/scmMaterials'

// SCM-0 主档/调整 action 行为锁 + 守卫 scm-uom-integer reverseTest：
// ① 计量整数一致（uom 只收 count|gram·建档锁死·调整 delta 必整数）② 料号命名契约（带结仅最大团）
// ③ 调整必留因 + 幂等（同 adjustId 重放不双记账）④ RBAC 默认拒（外包 403·仅超管）。

const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const SUPER = 'super-admin-key-123'
const OUT = 'outsourced-key-123'
const ctx = (data = {}, agentId = 'admin') => ({ db: null, cloud: null, data, drafts: {}, agentId })
const body = (r) => ({ status: r.statusCode, ...JSON.parse(r.body) })
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then(body)

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', caps: ['*'] },
    { _id: 'agent:out1', keyHash: sha(OUT), role: 'outsourced' },
  ])
})

// action 直调需要 db（listSuppliers/saveSupplier 用 Ctx.db）——同 index.ts 分发口径取 kit.getDb
import { getDb } from '../../packages/cloud/src/kit'
const dctx = (data = {}, agentId = 'admin') => ({ db: getDb(), cloud: null, data, drafts: {}, agentId })

describe('saveMaterial（料号命名契约 + uom 整数一致·守卫 scm-uom-integer）', () => {
  it('毛线料号推导 yarn:<color>:<tier>:<form>；带结仅最大团（KNOT_ONLY_L·用户拍板）', async () => {
    const ok = body(await scm.saveMaterial(dctx({ name: '红色大团带结', category: 'yarn', uom: 'count', color: 'red', tier: 'L', form: 'knotted' })))
    expect(ok.status).toBe(200)
    expect(ok.materialId).toBe('yarn:red:L:knotted')
    const badKnot = body(await scm.saveMaterial(dctx({ name: 'x', category: 'yarn', uom: 'count', color: 'red', tier: 'M', form: 'knotted' })))
    expect(badKnot.status).toBe(400)
    expect(badKnot.error).toBe('KNOT_ONLY_L')
  })

  it('uom 只收 count|gram（BAD_UOM）·建档后锁死（UOM_LOCKED）', async () => {
    expect(body(await scm.saveMaterial(dctx({ name: '棉', category: 'accessory', uom: 'kg', slug: 'stuffing' }))).error).toBe('BAD_UOM')
    expect(body(await scm.saveMaterial(dctx({ name: '棉', category: 'accessory', uom: 'gram', slug: 'stuffing' }))).status).toBe(200)
    const locked = body(await scm.saveMaterial(dctx({ name: '棉', category: 'accessory', uom: 'count', slug: 'stuffing' })))
    expect(locked.status).toBe(400)
    expect(locked.error).toBe('UOM_LOCKED')
  })

  it('专属件料号：packaging/card 挂 productId（pkg:/card: 前缀）', async () => {
    const pkg = body(await scm.saveMaterial(dctx({ name: '小鸭外包装', category: 'packaging', uom: 'count', productId: 'p-duck' })))
    expect(pkg.materialId).toBe('pkg:p-duck')
    const card = body(await scm.saveMaterial(dctx({ name: '小鸭激活卡', category: 'card', uom: 'count', productId: 'p-duck' })))
    expect(card.materialId).toBe('card:p-duck')
    expect(body(await scm.saveMaterial(dctx({ name: 'x', category: 'packaging', uom: 'count' }))).error).toBe('NO_PRODUCT')
  })

  it('辅料 slug 校验（小写 slug·防脏 _id）', async () => {
    expect(body(await scm.saveMaterial(dctx({ name: '记号扣', category: 'accessory', uom: 'count', slug: 'Marker!' }))).error).toBe('BAD_SLUG')
    expect(body(await scm.saveMaterial(dctx({ name: '记号扣', category: 'accessory', uom: 'count', slug: 'marker' }))).materialId).toBe('marker')
  })
})

describe('adjustStock（期初/调整·经门1·幂等·必留因）', () => {
  beforeEach(async () => {
    await scm.saveMaterial(dctx({ name: '钩针', category: 'accessory', uom: 'count', slug: 'hook' }))
  })

  it('必留因（NO_REASON）·delta 必非零整数（BAD_DELTA·克/件整数纪律）', async () => {
    expect(body(await scm.adjustStock(dctx({ materialId: 'hook', adjustId: 'a1', delta: 5 }))).error).toBe('NO_REASON')
    expect(body(await scm.adjustStock(dctx({ materialId: 'hook', adjustId: 'a1', delta: 1.5, reason: '盘点' }))).error).toBe('BAD_DELTA')
    expect(body(await scm.adjustStock(dctx({ materialId: 'hook', adjustId: 'a1', delta: 0, reason: '盘点' }))).error).toBe('BAD_DELTA')
  })

  it('期初入账 + 同 adjustId 重放幂等（不双记账）+ 操作者贯流水', async () => {
    const r1 = body(await scm.adjustStock(dctx({ materialId: 'hook', adjustId: 'init1', delta: 20, reason: '期初盘点' }, 'agent:out1')))
    expect(r1.status).toBe(200)
    expect(r1.applied).toBe(1)
    const r2 = body(await scm.adjustStock(dctx({ materialId: 'hook', adjustId: 'init1', delta: 20, reason: '期初盘点' })))
    expect(r2.applied).toBe(0)
    expect(control.dump('materials').find((m) => m._id === 'hook').stock).toBe(20)
    const rows = control.dump('stockLedger')
    expect(rows).toHaveLength(1)
    expect(rows[0].operator).toBe('agent:out1')
    expect(rows[0].reason).toBe('期初盘点')
  })

  it('扣超 → 409 INSUFFICIENT（余额不为负）', async () => {
    const r = body(await scm.adjustStock(dctx({ materialId: 'hook', adjustId: 'a9', delta: -5, reason: '损耗' })))
    expect(r.status).toBe(409)
    expect(r.error).toBe('INSUFFICIENT')
  })
})

describe('suppliers（厂家/织女主档）', () => {
  it('type 只收 factory|outworker；建/改/列', async () => {
    expect(body(await scm.saveSupplier(dctx({ name: '张织女', type: 'weaver' }))).error).toBe('BAD_TYPE')
    const created = body(await scm.saveSupplier(dctx({ name: '张织女', type: 'outworker', contact: '138xxxx' })))
    expect(created.status).toBe(200)
    expect(created.supplierId).toBeTruthy()
    const upd = body(await scm.saveSupplier(dctx({ supplierId: created.supplierId, name: '张织女A', type: 'outworker' })))
    expect(upd.status).toBe(200)
    expect(body(await scm.saveSupplier(dctx({ supplierId: 'ghost', name: 'x', type: 'factory' }))).error).toBe('NO_SUPPLIER')
    const list = body(await scm.listSuppliers(dctx()))
    expect(list.list).toHaveLength(1)
    expect(list.list[0].name).toBe('张织女A')
  })
})

describe('RBAC 默认拒（门5：未登记 ACTION_CAPS＝admin:write·仅超管）', () => {
  it('外包账号调 SCM 写/读 action → 403；超管 → 过闸', async () => {
    for (const a of ['saveMaterial', 'adjustStock', 'listMaterials', 'listLedger']) {
      expect((await call(a, OUT)).status, `外包 ${a} 应 403`).toBe(403)
    }
    expect((await call('listMaterials', SUPER)).status).toBe(200)
  })
})
