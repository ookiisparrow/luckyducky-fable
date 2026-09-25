// 客服/进销存后台：读失败 ≠ 空态、写失败 ≠ 撞号（根因#14）。
// 每条都对照「真没有」的正常语义，只把库挂/写挂这一支改成报错。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { applyStockMoves, saveMaterialDoc } from '../src/kit'

const SUPER = 'super-secret-key'
const A1 = 'outsourced-key-1'

const post = (action: string, key: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

// 单档读失败（doc(id).get）或查询读失败（where().get·无 id）
const failDocGet = (coll: string, id: string) =>
  control.setBeforeGet((a: any) => {
    if (a.coll === coll && a.id === id) throw new Error('MOCK_DB_FAIL')
  })
const failQueryGet = (coll: string) =>
  control.setBeforeGet((a: any) => {
    if (a.coll === coll && a.id === undefined) throw new Error('MOCK_DB_FAIL')
  })
const anomaly = (code: string) => control.dump('anomalies').find((a: any) => a.code === code)
const mat = (id: string, stock: number) => ({ _id: id, name: id, category: 'accessory', uom: 'count', stock, active: true })
const stockOf = (id: string) => control.dump('materials').find((m: any) => m._id === id)?.stock

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-1', keyHash: sha(A1), role: 'outsourced', name: '外包一号' },
    { _id: 'agent-2', keyHash: sha('outsourced-key-2'), role: 'outsourced', name: '外包二号' },
  ])
})
afterEach(() => {
  control.setBeforeGet(null as never)
  control.setBeforeAdd(null as never)
  control.setBeforeUpdate(null as never)
})

describe('质检抽检候选池读失败', () => {
  it('大白话：csSession 查询挂了回 500，不当「候选池已抽完」；也不打抽样标记', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 1 }])
    failQueryGet('csSession')
    const r = await post('sampleQc', SUPER, { count: 10 })
    expect(r.status).toBe(500)
    expect(r.sampled).toBeUndefined()
    expect(control.dump('csSession')[0].qcSampledAt).toBeUndefined()
  })
})

describe('坐席接待上限读失败', () => {
  it('大白话：切在线时 agentState 读挂了——不写库，已配的上限 10 不被覆盖成默认 5', async () => {
    control.seed('agentState', [{ _id: 'agent-1', status: 'online', limit: 10 }])
    failDocGet('agentState', 'agent-1')
    const r = await post('setAgentStatus', A1, { status: 'busy' })
    expect(r.ok).toBe(false)
    expect(control.dump('agentState')[0]).toMatchObject({ status: 'online', limit: 10 })
  })

  it('大白话：认领时 agentState 读挂了——拒认领，会话保持待接', async () => {
    control.seed('csSession', [{ _id: 's1', status: 'pending', externalUserId: 'eu', openKfId: 'kf', createdAt: 1, updatedAt: 1 }])
    control.seed('agentState', [{ _id: 'agent-1', status: 'online', limit: 10 }])
    failDocGet('agentState', 'agent-1')
    const r = await post('claimConversation', A1, { sessionId: 's1' })
    expect(r.ok).toBe(false)
    expect(control.dump('csSession')[0].status).toBe('pending')
  })

  it('大白话：真没有 agentState 档仍按默认上限建档', async () => {
    const r = await post('setAgentStatus', A1, { status: 'online' })
    expect(r.ok).toBe(true)
    expect(control.dump('agentState')[0]).toMatchObject({ _id: 'agent-1', limit: 5 })
  })
})

describe('外包账号写后复核读失败', () => {
  it('大白话：建号后复核企微 userid 查询挂了——回 503 且回滚刚建的号，不留没核验过的账号', async () => {
    let wecomGets = 0
    control.setBeforeGet((a: any) => {
      if (a.coll === 'adminConfig' && a.filter && a.filter.wecomUserId && ++wecomGets >= 2) throw new Error('MOCK_DB_FAIL')
    })
    const before = control.dump('adminConfig').map((a: any) => a._id)
    const r = await post('createAgent', SUPER, { name: '复核挂号', key: 'brand-new-key-9', wecomUserId: 'w-9' })
    expect(r.status).toBe(503)
    expect(r.error).toBe('WECOM_ID_LOOKUP_FAIL')
    expect(control.dump('adminConfig').map((a: any) => a._id)).toEqual(before)
  })

  it('大白话：改绑后复核查询挂了——回 503 且恢复旧绑定', async () => {
    let wecomGets = 0
    control.setBeforeGet((a: any) => {
      if (a.coll === 'adminConfig' && a.filter && a.filter.wecomUserId && ++wecomGets >= 2) throw new Error('MOCK_DB_FAIL')
    })
    const r = await post('setAgentWecomUserId', SUPER, { id: 'agent-2', wecomUserId: 'w-new' })
    expect(r.status).toBe(503)
    expect(r.error).toBe('WECOM_ID_LOOKUP_FAIL')
    expect(control.dump('adminConfig').find((a: any) => a._id === 'agent-2').wecomUserId).toBe('')
  })

  it('大白话：改绑撞号回滚本身失败——留 ROLLBACK_FAIL 痕，409 不变', async () => {
    control.setBeforeUpdate(({ coll, data }: any) => {
      if (coll !== 'adminConfig' || !data) return
      if (data.wecomUserId === 'w-race-9') control.seed('adminConfig', [{ _id: 'agent-race', role: 'outsourced', wecomUserId: 'w-race-9' }])
      if (data.wecomUserId === '') throw new Error('MOCK_ROLLBACK_FAIL')
    })
    const r = await post('setAgentWecomUserId', SUPER, { id: 'agent-2', wecomUserId: 'w-race-9' })
    expect(r.status).toBe(409)
    expect(r.error).toBe('WECOM_ID_TAKEN')
    expect(anomaly('ROLLBACK_FAIL')).toBeTruthy()
  })
})

describe('组装 claim 写失败', () => {
  it('大白话：组装单 add 因非撞号原因失败——回 500，不冒充「已执行过」409；一克料没扣', async () => {
    control.seed('config', [
      {
        _id: 'scmBomTemplate',
        commonLines: [{ materialId: 'stuffing', qtyPerSet: 2 }],
        yarnSlots: [
          { tier: 'L', form: 'knotted', qtyPerSet: 1 },
          { tier: 'M', form: 'raw', qtyPerSet: 1 },
        ],
      },
    ])
    control.seed('bomProfiles', [{ _id: 'p1', yarnColors: { L: 'pink', M: 'blue', S: 'green' }, packagingMaterialId: 'pkg:p1', cardMaterialId: 'card:p1' }])
    control.seed('materials', [mat('stuffing', 10), mat('yarn:pink:L:knotted', 5), mat('yarn:blue:M:raw', 5), mat('pkg:p1', 5), mat('card:p1', 5)])
    control.setBeforeAdd(({ coll }: any) => {
      if (coll === 'assemblyOrders') throw new Error('MOCK_TRANSIENT_WRITE_FAIL')
    })
    const r = await post('runAssembly', SUPER, { assemblyId: 'asm-x', productId: 'p1', spec: '', sets: 1 })
    expect(r.status).toBe(500)
    expect(r.error).not.toBe('DUPLICATE')
    expect(stockOf('stuffing')).toBe(10)
    expect(control.dump('assemblyOrders')).toEqual([])
  })
})

describe('外协/采购单档读失败', () => {
  beforeEach(() => {
    control.seed('suppliers', [
      { _id: 's1', name: '毛线厂', type: 'factory' },
      { _id: 'w1', name: '织女', type: 'outworker' },
    ])
    control.seed('materials', [mat('yarn:pink:L:raw', 5), mat('stuffing', 5)])
  })
  const outwork = (extra: Record<string, unknown> = {}) =>
    post('saveOutwork', SUPER, { workerId: 'w1', pieceRateFen: 100, issueLines: [{ materialId: 'yarn:pink:L:raw', qty: 1 }], ...extra })
  const purchase = (extra: Record<string, unknown> = {}) =>
    post('savePurchase', SUPER, { supplierId: 's1', lines: [{ materialId: 'stuffing', qty: 1, unitPriceFen: 100 }], ...extra })

  it('大白话：读织女档挂了回 500，不报「织女不存在」', async () => {
    failDocGet('suppliers', 'w1')
    const r = await outwork()
    expect(r.status).toBe(500)
    expect(r.error).not.toBe('NO_WORKER')
  })

  it('大白话：改外协草稿失败后判别读挂了回 500，不报「单据不存在」；收货读单据挂了同样 500', async () => {
    control.seed('outworkOrders', [{ _id: 'ow1', status: 'issued', workerId: 'w1', issueLines: [{ materialId: 'yarn:pink:L:raw', qty: 1 }], pieceRateFen: 100 }])
    failDocGet('outworkOrders', 'ow1')
    const edit = await outwork({ outworkId: 'ow1' })
    const recv = await post('receiveOutwork', SUPER, { outworkId: 'ow1', receiveLines: [{ materialId: 'yarn:pink:L:knotted', qty: 1 }] })
    expect(edit.status).toBe(500)
    expect(recv.status).toBe(500)
  })

  it('大白话：真没有织女档/单据仍 404', async () => {
    expect((await outwork({ workerId: 'ghost' })).error).toBe('NO_WORKER')
    expect((await outwork({ outworkId: 'ghost' })).error).toBe('NO_OUTWORK')
    expect((await post('receiveOutwork', SUPER, { outworkId: 'ghost' })).error).toBe('NO_OUTWORK')
  })

  it('大白话：采购读供应商挂了回 500，不报「供应商不对」；改草稿判别读挂了回 500，不报「单据不存在」', async () => {
    failDocGet('suppliers', 's1')
    const sup = await purchase()
    control.setBeforeGet(null as never)
    control.seed('purchaseOrders', [{ _id: 'po1', status: 'ordered', supplierId: 's1', lines: [] }])
    failDocGet('purchaseOrders', 'po1')
    const edit = await purchase({ purchaseId: 'po1' })
    expect(sup.status).toBe(500)
    expect(sup.error).not.toBe('BAD_SUPPLIER')
    expect(edit.status).toBe(500)
    expect(edit.error).not.toBe('NO_PURCHASE')
  })

  it('大白话：改草稿的条件更新写挂了回 500，不报「已不是草稿」；草稿原样', async () => {
    control.seed('outworkOrders', [{ _id: 'ow1', status: 'draft', workerId: 'w1', issueLines: [], pieceRateFen: 100 }])
    control.seed('purchaseOrders', [{ _id: 'po1', status: 'draft', supplierId: 's1', lines: [] }])
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === 'outworkOrders' || coll === 'purchaseOrders') throw new Error('MOCK_DB_FAIL')
    })
    const ow = await outwork({ outworkId: 'ow1' })
    const po = await purchase({ purchaseId: 'po1' })
    expect(ow.status).toBe(500)
    expect(ow.error).not.toBe('NOT_DRAFT')
    expect(po.status).toBe(500)
    expect(po.error).not.toBe('NOT_DRAFT')
    expect(control.dump('outworkOrders')[0].issueLines).toEqual([])
    expect(control.dump('purchaseOrders')[0].lines).toEqual([])
  })

  it('大白话：真没有供应商/采购单仍 400/404', async () => {
    expect((await purchase({ supplierId: 'ghost' })).error).toBe('BAD_SUPPLIER')
    expect((await purchase({ purchaseId: 'ghost' })).error).toBe('NO_PURCHASE')
  })
})

describe('门1 物料主档读失败', () => {
  it('大白话：改库存时主档读瞬断一次——重试成功，不报「物料不存在」', async () => {
    control.seed('materials', [mat('m1', 10)])
    let failed = 0
    control.setBeforeGet((a: any) => {
      if (a.coll === 'materials' && a.id === 'm1' && failed++ === 0) throw new Error('MOCK_DB_FAIL')
    })
    const r = await applyStockMoves([{ materialId: 'm1', delta: -3 }], { docType: 'adjust', docId: 'a1', reason: '测试' })
    expect(r).toEqual({ ok: true, applied: 1 })
    expect(stockOf('m1')).toBe(7)
    expect(anomaly('READ_FAILED')).toBeUndefined()
  })

  it('大白话：主档读一直挂——失败但不报 NO_MATERIAL，账不动、流水撤回；真没有主档仍 NO_MATERIAL', async () => {
    control.seed('materials', [mat('m1', 10)])
    failDocGet('materials', 'm1')
    const r = await applyStockMoves([{ materialId: 'm1', delta: -3 }], { docType: 'adjust', docId: 'a2', reason: '测试' })
    control.setBeforeGet(null as never)
    expect(r.ok).toBe(false)
    expect((r as any).error).not.toBe('NO_MATERIAL')
    expect(stockOf('m1')).toBe(10)
    expect(control.dump('stockLedger')).toEqual([])
    expect(anomaly('READ_FAILED')).toMatchObject({ ctx: expect.objectContaining({ fn: 'scmStock.casChange', materialId: 'm1' }) })
    const ghost = await applyStockMoves([{ materialId: 'ghost', delta: 1 }], { docType: 'adjust', docId: 'a3', reason: '测试' })
    expect(ghost).toMatchObject({ ok: false, error: 'NO_MATERIAL' })
  })

  it('大白话：保存主档时读挂了——报错，不走新建分支冒充「并发撞号」', async () => {
    control.seed('materials', [mat('acc:x', 3)])
    failDocGet('materials', 'acc:x')
    await expect(saveMaterialDoc({ _id: 'acc:x', name: 'x', category: 'accessory', uom: 'count' })).rejects.toThrow('MOCK_DB_FAIL')
  })

  it('大白话：新建主档 add 因非撞号原因失败——报错走 500，不冒充「并发撞号」409', async () => {
    control.setBeforeAdd(({ coll }: any) => {
      if (coll === 'materials') throw new Error('MOCK_TRANSIENT_WRITE_FAIL')
    })
    await expect(saveMaterialDoc({ _id: 'acc:y', name: 'y', category: 'accessory', uom: 'count' })).rejects.toThrow('MOCK_TRANSIENT_WRITE_FAIL')
    const r = await post('saveMaterial', SUPER, { name: 'y', category: 'accessory', uom: 'count', slug: 'y' })
    expect(r.status).toBe(500)
    expect(r.error).not.toBe('DUPLICATE')
    expect(control.dump('materials')).toEqual([])
  })
})

describe('认领回包（不重读会话）', () => {
  it('大白话：认领成功回的会话视图＝新状态＋本坐席＋认领时刻＋桥接 openid，与库里一致', async () => {
    control.seed('csSession', [{ _id: 's1', status: 'pending', externalUserId: 'eu1', openKfId: 'kf1', createdAt: 100, updatedAt: 100 }])
    control.seed('kfIdentity', [{ _id: 'ext:eu1', openid: 'o-1' }])
    const r = await post('claimConversation', A1, { sessionId: 's1' })
    const db = control.dump('csSession')[0]
    expect(r.session).toEqual({
      sessionId: 's1',
      externalUserId: 'eu1',
      openKfId: 'kf1',
      status: 'active',
      createdAt: 100,
      updatedAt: db.updatedAt,
      openid: 'o-1',
      agentId: 'agent-1',
      claimedAt: db.claimedAt,
    })
    expect(db.claimedAt).toBeGreaterThan(0)
  })
})
