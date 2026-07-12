// 黄金 inventory-scm §D（门1 唯一入出账口）/§E（物料主档）/§F（采购幂等）/§G（外协发收结算）
// /§H（配方解析与快照冻结）/§I（组装扣料入成品）/§K（备货计算器与产销统计）/§N（RBAC 默认拒）（守卫 rw-scm-golden）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

const SUPER = 'super-secret-key'
const A1 = 'outsourced-key-1'

const post = (action: string, key: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const mat = (id: string, stock: number, extra: Record<string, unknown> = {}) => ({
  _id: id,
  name: id,
  category: 'accessory',
  uom: 'count',
  stock,
  active: true,
  ...extra,
})
const stockOf = (id: string) => control.dump('materials').find((m: any) => m._id === id)?.stock

// 全局模板（共用料 stuffing×2 + L 带结×1 + M 原团×1）+ p1 差异位
const TEMPLATE = {
  commonLines: [{ materialId: 'stuffing', qtyPerSet: 2 }],
  yarnSlots: [
    { tier: 'L', form: 'knotted', qtyPerSet: 1 },
    { tier: 'M', form: 'raw', qtyPerSet: 1 },
  ],
}
const PROFILE_P1 = {
  yarnColors: { L: 'pink', M: 'blue', S: 'green' },
  packagingMaterialId: 'pkg:p1',
  cardMaterialId: 'card:p1',
}
const seedBom = () => {
  control.seed('config', [{ _id: 'scmBomTemplate', ...TEMPLATE }])
  control.seed('bomProfiles', [{ _id: 'p1', ...PROFILE_P1 }])
}

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-1', keyHash: sha(A1), role: 'outsourced', name: '外包一号' },
  ])
})

describe('RBAC 默认拒（黄金 §N：SCM 全线仅超管）', () => {
  it('大白话：外包对物料/采购/外协/组装/备货任一 action 一律 403——未登记的 action 默认按最高写权收口', async () => {
    for (const action of ['listMaterials', 'adjustStock', 'savePurchase', 'issueOutwork', 'runAssembly', 'getRestockPlan']) {
      const r = await post(action, A1, {})
      expect(r.status, action).toBe(403)
    }
  })
})

describe('物料主档（黄金 §E：料号契约·计量锁死·调整幂等）', () => {
  it('大白话：毛线料号按颜色×档位×形态推导且带结只许最大团；专属件要挂产品；脏 slug 拒；计量只收件|克且建档锁死；改名不动库存', async () => {
    const y = await post('saveMaterial', SUPER, { name: '粉色大团带结', category: 'yarn', uom: 'count', color: 'pink', tier: 'L', form: 'knotted' })
    expect(y.materialId).toBe('yarn:pink:L:knotted')
    expect(stockOf('yarn:pink:L:knotted')).toBe(0) // 建档初始化 0
    expect((await post('saveMaterial', SUPER, { name: 'x', category: 'yarn', uom: 'count', color: 'pink', tier: 'M', form: 'knotted' })).error).toBe('KNOT_ONLY_L')
    expect((await post('saveMaterial', SUPER, { name: 'x', category: 'packaging', uom: 'count' })).error).toBe('NO_PRODUCT')
    expect((await post('saveMaterial', SUPER, { name: 'x', category: 'accessory', uom: 'count', slug: 'Bad Slug' })).error).toBe('BAD_SLUG')
    expect((await post('saveMaterial', SUPER, { name: 'x', category: 'accessory', uom: 'meter', slug: 'ok' })).error).toBe('BAD_UOM')
    // 改名不动库存 + 计量锁死
    await post('adjustStock', SUPER, { materialId: 'yarn:pink:L:knotted', adjustId: 'adj-0', delta: 7, reason: '期初' })
    const rename = await post('saveMaterial', SUPER, { name: '新名字', category: 'yarn', uom: 'count', color: 'pink', tier: 'L', form: 'knotted' })
    expect(rename.ok).toBe(true)
    expect(stockOf('yarn:pink:L:knotted')).toBe(7) // 主档更新不碰余额
    expect((await post('saveMaterial', SUPER, { name: 'x', category: 'yarn', uom: 'gram', color: 'pink', tier: 'L', form: 'knotted' })).error).toBe('UOM_LOCKED')
    // 供应商：类型白名单 + 改不存在拒
    expect((await post('saveSupplier', SUPER, { name: '张三', type: 'friend' })).error).toBe('BAD_TYPE')
    expect((await post('saveSupplier', SUPER, { name: '张三', type: 'factory', supplierId: 'ghost' })).status).toBe(404)
  })

  it('大白话：库存调整必留原因、量须非零整数；同调整号重放不双记账；扣超余额拒且流水零残留', async () => {
    control.seed('materials', [mat('stuffing', 10)])
    expect((await post('adjustStock', SUPER, { materialId: 'stuffing', adjustId: 'a1', delta: 5 })).error).toBe('NO_REASON')
    expect((await post('adjustStock', SUPER, { materialId: 'stuffing', adjustId: 'a1', delta: 2.5, reason: 'x' })).error).toBe('BAD_DELTA')
    const r = await post('adjustStock', SUPER, { materialId: 'stuffing', adjustId: 'a1', delta: 5, reason: '盘盈' })
    expect(r.applied).toBe(1)
    expect(stockOf('stuffing')).toBe(15)
    const led = control.dump('stockLedger').find((l: any) => l._id === 'adjust:a1:stuffing')
    expect(led.reason).toBe('盘盈') // 流水记原因与操作者
    expect(led.operator).toBe('admin')
    // 同 adjustId 重放：撞幂等键跳过·余额不再动
    const replay = await post('adjustStock', SUPER, { materialId: 'stuffing', adjustId: 'a1', delta: 5, reason: '盘盈' })
    expect(replay.applied).toBe(0)
    expect(stockOf('stuffing')).toBe(15)
    // 扣超：拒 + 余额不动 + 流水零残留
    const over = await post('adjustStock', SUPER, { materialId: 'stuffing', adjustId: 'a2', delta: -999, reason: '误' })
    expect(over.status).toBe(409)
    expect(over.error).toBe('INSUFFICIENT')
    expect(stockOf('stuffing')).toBe(15)
    expect(control.dump('stockLedger').find((l: any) => l._id === 'adjust:a2:stuffing')).toBeFalsy()
  })
})

describe('采购线（黄金 §F：fail-closed·服务端算总价·收货首次流转入库幂等）', () => {
  beforeEach(() => {
    control.seed('suppliers', [
      { _id: 's1', name: '毛线厂', type: 'factory' },
      { _id: 'w1', name: '织女一号', type: 'outworker' },
    ])
    control.seed('materials', [mat('yarn:pink:L:raw', 0), mat('stuffing', 0)])
  })

  it('大白话：采购只向厂家；坏行（浮点量/负价/无档料/重复行）一律拒；总价服务端自算、前端假总价无视', async () => {
    expect((await post('savePurchase', SUPER, { supplierId: 'w1', lines: [{ materialId: 'stuffing', qty: 1, unitPriceFen: 1 }] })).error).toBe('BAD_SUPPLIER') // 织女不收采购单
    const L = (lines: any[]) => ({ supplierId: 's1', lines })
    expect((await post('savePurchase', SUPER, L([{ materialId: 'stuffing', qty: 1.5, unitPriceFen: 1 }]))).error).toBe('BAD_QTY')
    expect((await post('savePurchase', SUPER, L([{ materialId: 'stuffing', qty: 1, unitPriceFen: -1 }]))).error).toBe('BAD_PRICE')
    expect((await post('savePurchase', SUPER, L([{ materialId: 'ghost', qty: 1, unitPriceFen: 1 }]))).error).toBe('NO_MATERIAL')
    expect((await post('savePurchase', SUPER, L([{ materialId: 'stuffing', qty: 1, unitPriceFen: 1 }, { materialId: 'stuffing', qty: 2, unitPriceFen: 1 }]))).error).toBe('DUP_LINE')
    const ok = await post('savePurchase', SUPER, {
      supplierId: 's1',
      totalFen: 1, // 前端假总价·无视
      lines: [
        { materialId: 'yarn:pink:L:raw', qty: 10, unitPriceFen: 250 },
        { materialId: 'stuffing', qty: 5, unitPriceFen: 100 },
      ],
    })
    expect(ok.totalFen).toBe(3000) // Σ数量×单价 服务端算
    expect(control.dump('purchaseOrders')[0].totalFen).toBe(3000)
  })

  it('大白话：草稿→已下单→已收货正向走；收货首次流转才入库、重复收货不双入库；草稿直收拒；已收货不能取消、也不能再改', async () => {
    const created = await post('savePurchase', SUPER, {
      supplierId: 's1',
      lines: [
        { materialId: 'yarn:pink:L:raw', qty: 10, unitPriceFen: 250 },
        { materialId: 'stuffing', qty: 5, unitPriceFen: 100 },
      ],
    })
    const id = created.purchaseId
    // 草稿直收：状态机无此边·拒且账分毫不动
    const early = await post('receivePurchase', SUPER, { purchaseId: id })
    expect(early.status).toBe(409)
    expect(stockOf('stuffing')).toBe(0)
    expect((await post('markOrdered', SUPER, { purchaseId: id })).ok).toBe(true)
    expect((await post('savePurchase', SUPER, { supplierId: 's1', purchaseId: id, lines: [{ materialId: 'stuffing', qty: 1, unitPriceFen: 1 }] })).error).toBe('NOT_DRAFT') // 已下单不可改
    const recv = await post('receivePurchase', SUPER, { purchaseId: id })
    expect(recv.moved).toBe(true)
    expect(recv.applied).toBe(2)
    expect(stockOf('yarn:pink:L:raw')).toBe(10)
    expect(stockOf('stuffing')).toBe(5)
    // 重复收货：幂等·不双入库·流水每料仍只一条
    const again = await post('receivePurchase', SUPER, { purchaseId: id })
    expect(again).toMatchObject({ ok: true, moved: false })
    expect(stockOf('stuffing')).toBe(5)
    expect(control.dump('stockLedger').filter((l: any) => l.docType === 'purchase_in' && l.itemKey === 'stuffing').length).toBe(1)
    expect((await post('cancelPurchase', SUPER, { purchaseId: id })).status).toBe(409) // 入库后走调整单
    expect((await post('cancelPurchase', SUPER, { purchaseId: 'ghost' })).status).toBe(404)
  })
})

describe('外协线（黄金 §G：发料全有或全无·收货定格应付损耗·结算销账）', () => {
  beforeEach(() => {
    control.seed('suppliers', [
      { _id: 's1', name: '毛线厂', type: 'factory' },
      { _id: 'w1', name: '织女一号', type: 'outworker' },
    ])
    control.seed('materials', [mat('yarn:pink:L:raw', 10), mat('yarn:blue:L:raw', 1), mat('yarn:pink:L:knotted', 0)])
  })
  const draft = () =>
    post('saveOutwork', SUPER, {
      workerId: 'w1',
      pieceRateFen: 300,
      issueLines: [
        { materialId: 'yarn:pink:L:raw', qty: 4 },
        { materialId: 'yarn:blue:L:raw', qty: 2 },
      ],
    })

  it('大白话：外协单只认织女；发料只收最大团原团；计件价须整数分；发料缺一色则整单拒——足量色也不动账，补货后重发成功', async () => {
    expect((await post('saveOutwork', SUPER, { workerId: 's1', pieceRateFen: 1, issueLines: [{ materialId: 'yarn:pink:L:raw', qty: 1 }] })).error).toBe('NOT_OUTWORKER')
    expect((await post('saveOutwork', SUPER, { workerId: 'w1', pieceRateFen: 1, issueLines: [{ materialId: 'yarn:pink:M:raw', qty: 1 }] })).error).toBe('ISSUE_L_RAW_ONLY')
    expect((await post('saveOutwork', SUPER, { workerId: 'w1', pieceRateFen: 2.5, issueLines: [{ materialId: 'yarn:pink:L:raw', qty: 1 }] })).error).toBe('BAD_RATE')
    const d = await draft()
    const id = d.outworkId
    // 蓝色只有 1 团、要发 2：整单拒（全有或全无）·粉色足量也不动·状态补偿回滚回草稿
    const fail = await post('issueOutwork', SUPER, { outworkId: id })
    expect(fail.status).toBe(409)
    expect(fail.error).toBe('INSUFFICIENT')
    expect(stockOf('yarn:pink:L:raw')).toBe(10)
    expect(control.dump('outworkOrders')[0].status).toBe('draft') // 回滚·可重试
    await post('adjustStock', SUPER, { materialId: 'yarn:blue:L:raw', adjustId: 'restock', delta: 5, reason: '补货' })
    const ok = await post('issueOutwork', SUPER, { outworkId: id })
    expect(ok.ok).toBe(true)
    expect(stockOf('yarn:pink:L:raw')).toBe(6)
    expect(stockOf('yarn:blue:L:raw')).toBe(4)
  })

  it('大白话：收货只认发过颜色的带结团、收不能比发多、未建档提示先建档；应付=收×单价、损耗=发−收一次定格；重复收货/未收先结/发料后取消一律拒', async () => {
    const d = await draft()
    const id = d.outworkId
    await post('adjustStock', SUPER, { materialId: 'yarn:blue:L:raw', adjustId: 'restock', delta: 5, reason: '补货' })
    expect((await post('receiveOutwork', SUPER, { outworkId: id, receiveLines: [{ materialId: 'yarn:pink:L:knotted', qty: 1 }] })).error).toBe('NOT_ISSUED') // 未发先收拒
    await post('issueOutwork', SUPER, { outworkId: id })
    const R = (lines: any[]) => post('receiveOutwork', SUPER, { outworkId: id, receiveLines: lines })
    expect((await R([{ materialId: 'yarn:pink:L:raw', qty: 1 }])).error).toBe('RECEIVE_L_KNOTTED_ONLY')
    expect((await R([{ materialId: 'yarn:green:L:knotted', qty: 1 }])).error).toBe('COLOR_NOT_ISSUED')
    expect((await R([{ materialId: 'yarn:pink:L:knotted', qty: 5 }])).error).toBe('RECEIVE_EXCEEDS_ISSUE') // 发 4 收 5
    const noDoc = await R([{ materialId: 'yarn:blue:L:knotted', qty: 1 }])
    expect(noDoc.error).toBe('NO_MATERIAL') // 带结未建档·不静默建档
    expect(control.dump('outworkOrders')[0].status).toBe('issued') // 拒时状态不动
    const ok = await R([{ materialId: 'yarn:pink:L:knotted', qty: 3 }])
    expect(ok.payableFen).toBe(900) // 3 团 × 300 分
    expect(ok.lossQty).toBe(3) // 发 6 − 收 3
    expect(stockOf('yarn:pink:L:knotted')).toBe(3)
    expect((await R([{ materialId: 'yarn:pink:L:knotted', qty: 3 }])).error).toBe('NOT_ISSUED') // 重放幂等·定格不变
    expect(control.dump('outworkOrders')[0].payableFen).toBe(900)
    expect((await post('cancelOutwork', SUPER, { outworkId: id })).error).toBe('NOT_DRAFT') // 发料后不可取消
    expect((await post('settleOutwork', SUPER, { outworkId: id })).ok).toBe(true)
    expect((await post('settleOutwork', SUPER, { outworkId: id })).error).toBe('NOT_DELIVERED') // 重复结算拒
    expect((await post('listOutworks', SUPER, { status: '不存在的态' })).error).toBe('BAD_STATUS')
  })
})

describe('配方管理与组装（黄金 §H/§I：契约校验·快照冻结·幂等·全单回滚）', () => {
  const seedAssemblyStock = () =>
    control.seed('materials', [
      mat('stuffing', 10),
      mat('yarn:pink:L:knotted', 5),
      mat('yarn:blue:M:raw', 5),
      mat('pkg:p1', 5),
      mat('card:p1', 5),
    ])

  it('大白话：模板/差异位走契约校验——带结槽只许 L 档、每套用量正整数、三色与专属件必填；保存后可读回', async () => {
    expect((await post('saveBomTemplate', SUPER, { template: { commonLines: [], yarnSlots: [{ tier: 'M', form: 'knotted', qtyPerSet: 1 }] } })).error).toBe('BAD_TEMPLATE')
    expect((await post('saveBomTemplate', SUPER, { template: { commonLines: [{ materialId: 'stuffing', qtyPerSet: 1.5 }], yarnSlots: [{ tier: 'L', form: 'raw', qtyPerSet: 1 }] } })).error).toBe('BAD_TEMPLATE')
    expect((await post('saveBomTemplate', SUPER, { template: TEMPLATE })).ok).toBe(true)
    expect((await post('saveBomProfile', SUPER, { profile: { productId: 'p1', yarnColors: { L: 'pink', M: '' }, packagingMaterialId: 'x', cardMaterialId: 'x' } })).error).toBe('BAD_COLOR')
    expect((await post('saveBomProfile', SUPER, { profile: { productId: 'p1', yarnColors: { L: 'pink', M: 'blue', S: 'green' }, packagingMaterialId: '', cardMaterialId: 'x' } })).error).toBe('NO_SPECIFIC')
    expect((await post('saveBomProfile', SUPER, { profile: { productId: 'p1', ...PROFILE_P1 } })).ok).toBe(true)
    const setup = await post('getBomSetup', SUPER, {})
    expect(setup.template.yarnSlots.length).toBe(2)
    expect(setup.profiles[0]._id).toBe('p1')
  })

  it('大白话：productId 尾随/前导空格先 trim 再落 _id——不然会写进不存在的幽灵产品、真实产品持续「未填差异位」（D1）', async () => {
    const r = await post('saveBomProfile', SUPER, { profile: { productId: 'abc123 ', ...PROFILE_P1 } })
    expect(r.ok).toBe(true)
    expect(r.productId).toBe('abc123') // 落库 _id 已 trim，不是 'abc123 '
    const setup = await post('getBomSetup', SUPER, {})
    expect(setup.profiles.map((p: any) => p._id)).toContain('abc123')
    expect(setup.profiles.map((p: any) => p._id)).not.toContain('abc123 ')
    expect((await post('saveBomProfile', SUPER, { profile: { productId: '   ', ...PROFILE_P1 } })).error).toBe('NO_PRODUCT') // 纯空白 trim 后拒
  })

  it('大白话：组装＝解析→快照冻结→扣原料→入成品；同组装号重放拒不双扣；料不足全单回滚一分不动；之后改模板历史单快照不追新', async () => {
    seedBom()
    seedAssemblyStock()
    const r = await post('runAssembly', SUPER, { assemblyId: 'asm-1', productId: 'p1', spec: '', sets: 2 })
    expect(r.ok).toBe(true)
    // 扣原料：stuffing 2×2 / 带结 1×2 / M 原团 1×2 / 专属件各 ×2
    expect(stockOf('stuffing')).toBe(6)
    expect(stockOf('yarn:pink:L:knotted')).toBe(3)
    expect(stockOf('yarn:blue:M:raw')).toBe(3)
    expect(stockOf('pkg:p1')).toBe(3)
    expect(stockOf('card:p1')).toBe(3)
    // 入成品（无档则建）+ fg 流水留痕
    expect(control.dump('inventory').find((d: any) => d._id === 'p1__').stock).toBe(2)
    expect(control.dump('stockLedger').find((l: any) => l._id === 'assembly_in:asm-1:fg:p1__').delta).toBe(2)
    // 幂等：同 assemblyId 重放 409·不双扣
    expect((await post('runAssembly', SUPER, { assemblyId: 'asm-1', productId: 'p1', spec: '', sets: 2 })).status).toBe(409)
    expect(stockOf('stuffing')).toBe(6)
    // 料不足：全单回滚（原料/成品/单据全不动·可重试）并指出短缺料号
    const short = await post('runAssembly', SUPER, { assemblyId: 'asm-2', productId: 'p1', spec: '', sets: 10 })
    expect(short.status).toBe(409)
    expect(short.error).toBe('INSUFFICIENT')
    expect(short.materialId).toBeTruthy()
    expect(stockOf('stuffing')).toBe(6)
    expect(control.dump('inventory').find((d: any) => d._id === 'p1__').stock).toBe(2)
    expect(control.dump('assemblyOrders').find((d: any) => d._id === 'asm-2')).toBeFalsy() // 占用撤回
    // 快照冻结：改模板后历史组装单的快照与已耗清单不追新
    await post('saveBomTemplate', SUPER, { template: { ...TEMPLATE, commonLines: [{ materialId: 'stuffing', qtyPerSet: 9 }] } })
    const doc = control.dump('assemblyOrders').find((d: any) => d._id === 'asm-1')
    expect(doc.bomSnapshot.template.commonLines[0].qtyPerSet).toBe(2)
    expect(doc.consumedLines.find((l: any) => l.materialId === 'stuffing').qty).toBe(4)
  })

  it('大白话（N3·bug 清除战役II 遗留·病根14）：料不足回滚撤 claim 若也失败——会留孤 claim 文档（重试永远撞 DUPLICATE），必须留痕；409 回复不变', async () => {
    seedBom()
    seedAssemblyStock()
    // spy 挂在共享 DocRef 原型上（同 app-admin2.test.ts REMOVE_FAIL 范式）——但 DocRef 原型跨集合共享，
    // applyStockMoves 内部（kit/scmStock）自己的流水回滚也会先调 remove()：用 mockImplementationOnce 会被
    // 那次无关调用先吃掉，测不到目标场景。按 this.coll 只挑 assemblyOrders 这一路失败，其余集合走真实现。
    const docProto = Object.getPrototypeOf(getDb().collection('assemblyOrders').doc('x'))
    const origRemove = docProto.remove
    const spy = vi.spyOn(docProto, 'remove').mockImplementation(function (this: any, ...args: unknown[]) {
      if (this.coll === 'assemblyOrders') return Promise.reject(new Error('MOCK_REMOVE_FAIL'))
      return origRemove.apply(this, args)
    })
    let r: any
    try {
      r = await post('runAssembly', SUPER, { assemblyId: 'asm-fail', productId: 'p1', spec: '', sets: 10 }) // 料不足→触发回滚
    } finally {
      spy.mockRestore()
    }
    expect(r.status).toBe(409) // 回滚失败不改变返回语义
    expect(r.error).toBe('INSUFFICIENT')
    // 孤 claim 文档真残留了（撤销没能撤掉）——正是要留痕的场景
    expect(control.dump('assemblyOrders').find((d: any) => d._id === 'asm-fail')).toBeTruthy()
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'CLAIM_ROLLBACK_FAIL' && a.ctx && a.ctx.assemblyId === 'asm-fail')).toBe(true)
  })

  it('大白话：不限量成品保持不限量不翻成限量；预演只读给出短缺不动账；无差异位/坏套数拒', async () => {
    seedBom()
    seedAssemblyStock()
    control.seed('inventory', [{ _id: 'p1__', productId: 'p1', spec: '', stock: null }]) // 不限量
    const r = await post('runAssembly', SUPER, { assemblyId: 'asm-3', productId: 'p1', spec: '', sets: 1 })
    expect(r.ok).toBe(true)
    expect(control.dump('inventory').find((d: any) => d._id === 'p1__').stock).toBeNull() // 不隐式翻限量
    // 预演只读：短缺对照·不动账
    const before = stockOf('stuffing')
    const pv = await post('previewAssembly', SUPER, { productId: 'p1', sets: 100 })
    const line = pv.lines.find((l: any) => l.materialId === 'stuffing')
    expect(line.short).toBe(200 - (before as number))
    expect(stockOf('stuffing')).toBe(before)
    expect((await post('runAssembly', SUPER, { assemblyId: 'x', productId: 'nope', sets: 1 })).error).toBe('NO_PROFILE')
    expect((await post('runAssembly', SUPER, { assemblyId: 'x', productId: 'p1', sets: 0 })).error).toBe('BAD_SETS')
    // 深审 P3：spec 含复合键分隔符 __ 拒（防撞进别的 fg:productId__spec 库存文档）
    expect((await post('runAssembly', SUPER, { assemblyId: 'x', productId: 'p1', spec: 'a__b', sets: 1 })).error).toBe('BAD_SPEC')
  })
})

describe('备货计算器与产销统计（黄金 §K：只读·带结不外购·按供应商分列）', () => {
  it('大白话：带结缺口=应发同色原团数并叠回采购口径；采购缺口按供应商分列、够扣不出行、未建档点名归未挂组；带结绝不出现在采购缺口', async () => {
    seedBom()
    control.seed('suppliers', [{ _id: 's1', name: '毛线厂', type: 'factory' }])
    control.seed('materials', [
      mat('yarn:pink:L:knotted', 1), // 需 4 → 外协缺 3
      mat('yarn:pink:L:raw', 0, { supplierId: 's1' }), // 派生原团需求 3 → 采购缺 3
      mat('yarn:blue:M:raw', 0, { supplierId: 's1' }), // 需 4 → 缺 4
      mat('stuffing', 8), // 需 8 → 够·不出行
      mat('pkg:p1', 4), // 需 4 → 够
      // card:p1 未建档 → missing + 未挂组
    ])
    const r = await post('getRestockPlan', SUPER, { targets: [{ productId: 'p1', sets: 4 }] })
    expect(r.ok).toBe(true)
    expect(r.outworkGaps).toEqual([{ color: 'pink', knottedNeed: 4, knottedStock: 1, gap: 3, rawToIssue: 3 }])
    const allLines = r.purchaseGroups.flatMap((g: any) => g.lines)
    expect(allLines.find((l: any) => l.materialId === 'yarn:pink:L:raw').gap).toBe(3) // 派生原团进采购
    expect(allLines.find((l: any) => l.materialId === 'yarn:blue:M:raw').gap).toBe(4)
    expect(allLines.find((l: any) => l.materialId === 'stuffing')).toBeFalsy() // 够扣不出行
    expect(allLines.some((l: any) => l.materialId.includes(':knotted'))).toBe(false) // 带结不外购
    expect(r.missingMaterials).toContain('card:p1')
    expect(r.purchaseGroups.find((g: any) => g.supplierId === '').supplierName).toBe('未挂供应商')
    expect((await post('getRestockPlan', SUPER, { targets: [{ productId: 'p1', sets: 0 }] })).error).toBe('BAD_TARGETS')
  })

  it('大白话：全部够 → 外协/采购/缺料三空不造缺口；产销统计按产品+规格分桶——打包累计、发货负转正、非成品流水不混入', async () => {
    seedBom()
    control.seed('materials', [
      mat('yarn:pink:L:knotted', 9),
      mat('yarn:blue:M:raw', 9),
      mat('stuffing', 9),
      mat('pkg:p1', 9),
      mat('card:p1', 9),
    ])
    const r = await post('getRestockPlan', SUPER, { targets: [{ productId: 'p1', sets: 2 }] })
    expect(r.outworkGaps).toEqual([])
    expect(r.purchaseGroups).toEqual([])
    expect(r.missingMaterials).toEqual([])
    // 产销统计（fg 流水汇总·只读）
    control.seed('stockLedger', [
      { _id: 'assembly_in:a1:fg:p1__', docType: 'assembly_in', itemKey: 'fg:p1__', delta: 5 },
      { _id: 'assembly_in:a2:fg:p1__red', docType: 'assembly_in', itemKey: 'fg:p1__red', delta: 3 },
      { _id: 'ship:o1:fg:p1__', docType: 'ship', itemKey: 'fg:p1__', delta: -2 },
      { _id: 'purchase_in:x:stuffing', docType: 'purchase_in', itemKey: 'stuffing', delta: 99 }, // 非成品流水不混入
    ])
    const fg = await post('getFgSummary', SUPER, {})
    expect(fg.packed).toContainEqual({ productId: 'p1', spec: '', qty: 5 })
    expect(fg.packed).toContainEqual({ productId: 'p1', spec: 'red', qty: 3 })
    expect(fg.shipped).toEqual([{ productId: 'p1', spec: '', qty: 2 }])
  })
})
