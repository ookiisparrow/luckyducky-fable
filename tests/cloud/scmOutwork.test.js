import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'
import * as ow from '../../packages/cloud/src/functions/admin/adminApi/actions/scmOutwork'
import { getDb } from '../../packages/cloud/src/kit'

// SCM 车道 B 外协线行为锁（蓝图 §4B·业务定稿：发最大团原团→收同色带结→损耗可见→计件应付→结算）：
// ① 草稿校验 fail-closed（织女档/L 原团料号/正整数/单价整数分）② 发料首次流转绑出库（流水确定性 id 幂等）
// ③ 库存不足→状态补偿回滚 draft（宁不动账勿错账）④ 收货入带结 + payableFen/lossQty 与流转同一次更新定格
// ⑤ 收比发多/非发料颜色/带结未建档 全拒 ⑥ 重放幂等（moved=false 不双记账）⑦ RBAC 默认拒（外包 403 仅超管）。

const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const SUPER = 'super-admin-key-123'
const OUT = 'outsourced-key-123'
const body = (r) => ({ status: r.statusCode, ...JSON.parse(r.body) })
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then(body)
// action 直调口径同 index.ts 分发（db 经 kit.getDb·agentId 由分发处从 checkKey 贯入）
const dctx = (data = {}, agentId = 'admin') => ({ db: getDb(), cloud: null, data, drafts: {}, agentId })

const RED_RAW = 'yarn:red:L:raw'
const RED_KNOT = 'yarn:red:L:knotted'
const BLUE_RAW = 'yarn:blue:L:raw'

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', caps: ['*'] },
    { _id: 'agent:out1', keyHash: sha(OUT), role: 'outsourced' },
  ])
  control.seed('suppliers', [
    { _id: 'w1', name: '张织女', type: 'outworker', active: true },
    { _id: 'f1', name: 'XX 纺织厂', type: 'factory', active: true },
  ])
  // 主档：红色 原/带结 都建档；蓝色只建原团（带结未建档→收货 NO_MATERIAL 用例）
  control.seed('materials', [
    { _id: RED_RAW, name: '红大团原', category: 'yarn', uom: 'count', stock: 10, active: true },
    { _id: RED_KNOT, name: '红大团带结', category: 'yarn', uom: 'count', stock: 0, active: true },
    { _id: BLUE_RAW, name: '蓝大团原', category: 'yarn', uom: 'count', stock: 5, active: true },
    { _id: 'yarn:red:M:raw', name: '红中团原', category: 'yarn', uom: 'count', stock: 9, active: true },
  ])
})

const draft = async (over = {}) =>
  body(await ow.saveOutwork(dctx({ workerId: 'w1', pieceRateFen: 700, issueLines: [{ materialId: RED_RAW, qty: 5 }], ...over })))
const stockOf = (id) => control.dump('materials').find((m) => m._id === id).stock
const orderOf = (id) => control.dump('outworkOrders').find((o) => o._id === id)

describe('saveOutwork（草稿校验 fail-closed）', () => {
  it('workerId 须存在且是织女档（厂家 NOT_OUTWORKER·不存在 NO_WORKER）', async () => {
    expect((await draft({ workerId: 'f1' })).error).toBe('NOT_OUTWORKER')
    expect((await draft({ workerId: 'ghost' })).status).toBe(404)
    expect((await draft({ workerId: '' })).error).toBe('NO_WORKER')
  })

  it('发料行只收最大团原团（中团/带结 ISSUE_L_RAW_ONLY）·未建档 NO_MATERIAL·qty 正整数', async () => {
    expect((await draft({ issueLines: [{ materialId: 'yarn:red:M:raw', qty: 1 }] })).error).toBe('ISSUE_L_RAW_ONLY')
    expect((await draft({ issueLines: [{ materialId: RED_KNOT, qty: 1 }] })).error).toBe('ISSUE_L_RAW_ONLY')
    expect((await draft({ issueLines: [{ materialId: 'yarn:pink:L:raw', qty: 1 }] })).error).toBe('NO_MATERIAL')
    expect((await draft({ issueLines: [{ materialId: RED_RAW, qty: 1.5 }] })).error).toBe('BAD_LINES')
    expect((await draft({ issueLines: [{ materialId: RED_RAW, qty: 0 }] })).error).toBe('BAD_LINES')
    expect((await draft({ issueLines: [] })).error).toBe('BAD_LINES')
  })

  it('计件单价须非负整数分（浮点/负数 BAD_RATE·金额分纪律）', async () => {
    expect((await draft({ pieceRateFen: 7.5 })).error).toBe('BAD_RATE')
    expect((await draft({ pieceRateFen: -1 })).error).toBe('BAD_RATE')
    expect((await draft({ pieceRateFen: '700' })).error).toBe('BAD_RATE') // 字符串不隐式转（fail-closed）
  })

  it('建草稿成功·仅 draft 可改（发料后改行被拒 NOT_DRAFT）', async () => {
    const created = await draft()
    expect(created.status).toBe(200)
    expect(orderOf(created.outworkId).status).toBe('draft')
    const upd = await draft({ outworkId: created.outworkId, pieceRateFen: 800 })
    expect(upd.status).toBe(200)
    expect(orderOf(created.outworkId).pieceRateFen).toBe(800)
    await ow.issueOutwork(dctx({ outworkId: created.outworkId }))
    expect((await draft({ outworkId: created.outworkId, pieceRateFen: 900 })).error).toBe('NOT_DRAFT')
    expect((await draft({ outworkId: 'ghost' })).status).toBe(404)
  })
})

describe('issueOutwork（draft→issued 首次流转绑出库·幂等·不足回滚）', () => {
  it('发料出库扣账 + 流水确定性 id outwork_issue:<单>:<料号> + 操作者贯流水', async () => {
    const { outworkId } = await draft({ issueLines: [{ materialId: RED_RAW, qty: 3 }, { materialId: BLUE_RAW, qty: 2 }] })
    const r = body(await ow.issueOutwork(dctx({ outworkId }, 'agent:out1')))
    expect(r.status).toBe(200)
    expect(r.applied).toBe(2)
    expect(stockOf(RED_RAW)).toBe(7)
    expect(stockOf(BLUE_RAW)).toBe(3)
    expect(orderOf(outworkId).status).toBe('issued')
    const rows = control.dump('stockLedger')
    const red = rows.find((l) => l._id === `outwork_issue:${outworkId}:${RED_RAW}`)
    expect(red.delta).toBe(-3)
    expect(red.operator).toBe('agent:out1')
    // 重放：moved=false 不双出库（幂等）
    expect(body(await ow.issueOutwork(dctx({ outworkId }))).error).toBe('NOT_DRAFT')
    expect(stockOf(RED_RAW)).toBe(7)
    expect(control.dump('stockLedger')).toHaveLength(2)
  })

  it('库存不足 → 409 INSUFFICIENT 且状态补偿回滚回 draft（全有或全无·足量行也不动账）', async () => {
    const { outworkId } = await draft({ issueLines: [{ materialId: RED_RAW, qty: 3 }, { materialId: BLUE_RAW, qty: 999 }] })
    const r = body(await ow.issueOutwork(dctx({ outworkId })))
    expect(r.status).toBe(409)
    expect(r.error).toBe('INSUFFICIENT')
    expect(orderOf(outworkId).status).toBe('draft') // 补偿回滚——可补库存后重试
    expect(stockOf(RED_RAW)).toBe(10) // 足量行也回滚（applyStockMoves 全有或全无）
    expect(stockOf(BLUE_RAW)).toBe(5)
    expect(control.dump('stockLedger')).toHaveLength(0)
    // 回滚后补足可重发
    await ow.saveOutwork(dctx({ outworkId, workerId: 'w1', pieceRateFen: 700, issueLines: [{ materialId: BLUE_RAW, qty: 5 }] }))
    expect(body(await ow.issueOutwork(dctx({ outworkId }))).status).toBe(200)
  })
})

describe('receiveOutwork（issued→delivered·入带结+定格应付/损耗·同一次条件更新）', () => {
  let outworkId
  beforeEach(async () => {
    outworkId = (await draft({ issueLines: [{ materialId: RED_RAW, qty: 5 }], pieceRateFen: 700 })).outworkId
    await ow.issueOutwork(dctx({ outworkId }))
  })

  it('收 4 团带结：入库 + payableFen=4×700 lossQty=1 与状态同 doc 定格 + 流水 outwork_receive', async () => {
    const r = body(await ow.receiveOutwork(dctx({ outworkId, receiveLines: [{ materialId: RED_KNOT, qty: 4 }] })))
    expect(r.status).toBe(200)
    expect(r.payableFen).toBe(2800)
    expect(r.lossQty).toBe(1)
    expect(stockOf(RED_KNOT)).toBe(4)
    const doc = orderOf(outworkId)
    expect(doc.status).toBe('delivered')
    expect(doc.payableFen).toBe(2800) // 定格随流转同一次条件更新落库（不可分两步）
    expect(doc.lossQty).toBe(1)
    expect(control.dump('stockLedger').find((l) => l._id === `outwork_receive:${outworkId}:${RED_KNOT}`).delta).toBe(4)
    // 重放：NOT_ISSUED·不双入库、定格不变（幂等）
    expect(body(await ow.receiveOutwork(dctx({ outworkId, receiveLines: [{ materialId: RED_KNOT, qty: 4 }] }))).error).toBe('NOT_ISSUED')
    expect(stockOf(RED_KNOT)).toBe(4)
    expect(orderOf(outworkId).payableFen).toBe(2800)
  })

  it('收比发多拒（RECEIVE_EXCEEDS_ISSUE）·非发料颜色拒（COLOR_NOT_ISSUED）·非带结料号拒', async () => {
    expect(body(await ow.receiveOutwork(dctx({ outworkId, receiveLines: [{ materialId: RED_KNOT, qty: 6 }] }))).error).toBe('RECEIVE_EXCEEDS_ISSUE')
    expect(body(await ow.receiveOutwork(dctx({ outworkId, receiveLines: [{ materialId: 'yarn:blue:L:knotted', qty: 1 }] }))).error).toBe('COLOR_NOT_ISSUED')
    expect(body(await ow.receiveOutwork(dctx({ outworkId, receiveLines: [{ materialId: RED_RAW, qty: 1 }] }))).error).toBe('RECEIVE_L_KNOTTED_ONLY')
    expect(orderOf(outworkId).status).toBe('issued') // 全部拒在流转前——状态未动（fail-closed）
    expect(stockOf(RED_KNOT)).toBe(0)
  })

  it('带结料号未建档 → NO_MATERIAL（fail-closed 不静默建档·提示先建档·状态不动）', async () => {
    const bid = (await draft({ issueLines: [{ materialId: BLUE_RAW, qty: 2 }] })).outworkId
    await ow.issueOutwork(dctx({ outworkId: bid }))
    const r = body(await ow.receiveOutwork(dctx({ outworkId: bid, receiveLines: [{ materialId: 'yarn:blue:L:knotted', qty: 2 }] })))
    expect(r.status).toBe(400)
    expect(r.error).toBe('NO_MATERIAL')
    expect(r.hint).toContain('先在物料页建带结团档')
    expect(orderOf(bid).status).toBe('issued')
    expect(control.dump('materials').find((m) => m._id === 'yarn:blue:L:knotted')).toBeUndefined() // 没被偷偷建档
  })

  it('未发料先收货拒（NOT_ISSUED）·收货行为空/浮点拒（BAD_LINES）', async () => {
    const did = (await draft()).outworkId // 还在 draft
    expect(body(await ow.receiveOutwork(dctx({ outworkId: did, receiveLines: [{ materialId: RED_KNOT, qty: 1 }] }))).error).toBe('NOT_ISSUED')
    expect(body(await ow.receiveOutwork(dctx({ outworkId, receiveLines: [] }))).error).toBe('BAD_LINES')
    expect(body(await ow.receiveOutwork(dctx({ outworkId, receiveLines: [{ materialId: RED_KNOT, qty: 2.5 }] }))).error).toBe('BAD_LINES')
  })
})

describe('settle / cancel（销账与取消·只走声明流转）', () => {
  it('delivered→settled 记 settledAt；重复结算/未收货结算拒（NOT_DELIVERED）', async () => {
    const { outworkId } = await draft()
    expect(body(await ow.settleOutwork(dctx({ outworkId }))).error).toBe('NOT_DELIVERED') // draft 不能直接销账
    await ow.issueOutwork(dctx({ outworkId }))
    await ow.receiveOutwork(dctx({ outworkId, receiveLines: [{ materialId: RED_KNOT, qty: 5 }] }))
    const r = body(await ow.settleOutwork(dctx({ outworkId })))
    expect(r.status).toBe(200)
    const doc = orderOf(outworkId)
    expect(doc.status).toBe('settled')
    expect(doc.settledAt).toBeTruthy()
    expect(body(await ow.settleOutwork(dctx({ outworkId }))).error).toBe('NOT_DELIVERED') // 幂等重放拒
  })

  it('仅 draft 可取消；已发料 cancel 拒（异常走物料页调整单·蓝图定稿）', async () => {
    const a = (await draft()).outworkId
    expect(body(await ow.cancelOutwork(dctx({ outworkId: a }))).status).toBe(200)
    expect(orderOf(a).status).toBe('cancelled')
    expect(body(await ow.issueOutwork(dctx({ outworkId: a }))).error).toBe('NOT_DRAFT') // 取消后不能再发
    const b = (await draft()).outworkId
    await ow.issueOutwork(dctx({ outworkId: b }))
    expect(body(await ow.cancelOutwork(dctx({ outworkId: b }))).error).toBe('NOT_DRAFT')
    expect(orderOf(b).status).toBe('issued')
  })
})

describe('listOutworks（bounded·过滤·倒序）', () => {
  it('按 status/workerId 过滤·createdAt 倒序·非法 status 拒', async () => {
    control.seed('suppliers', [{ _id: 'w2', name: '李织女', type: 'outworker' }])
    const a = (await draft()).outworkId
    const b = (await draft({ workerId: 'w2' })).outworkId
    await ow.issueOutwork(dctx({ outworkId: a }))
    const all = body(await ow.listOutworks(dctx()))
    expect(all.list).toHaveLength(2)
    const issued = body(await ow.listOutworks(dctx({ status: 'issued' })))
    expect(issued.list.map((o) => o._id)).toEqual([a])
    const w2 = body(await ow.listOutworks(dctx({ workerId: 'w2' })))
    expect(w2.list.map((o) => o._id)).toEqual([b])
    expect(body(await ow.listOutworks(dctx({ status: 'bogus' }))).error).toBe('BAD_STATUS')
  })
})

describe('RBAC 默认拒（门5：未登记 ACTION_CAPS＝admin:write·仅超管）', () => {
  it('外包账号调外协 6 action → 403；超管 → 过闸', async () => {
    for (const a of ['listOutworks', 'saveOutwork', 'issueOutwork', 'receiveOutwork', 'settleOutwork', 'cancelOutwork']) {
      expect((await call(a, OUT)).status, `外包 ${a} 应 403`).toBe(403)
    }
    expect((await call('listOutworks', SUPER)).status).toBe(200)
  })
})
