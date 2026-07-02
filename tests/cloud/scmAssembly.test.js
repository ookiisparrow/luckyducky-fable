import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'
import { getDb } from '../../packages/cloud/src/kit'
import * as bom from '../../packages/cloud/src/functions/admin/adminApi/actions/scmBom'
import * as asm from '../../packages/cloud/src/functions/admin/adminApi/actions/scmAssembly'

// SCM-C 组装线行为锁 + 守卫 bom-snapshot-frozen reverseTest：
// ① 模板/差异位管理（knotted 仅 L·白名单入库）② 组装执行 = 门3 解析→快照冻结→门1 扣料→门4 入成品→assembly_in 留痕
// ③ **快照冻结**：改模板后历史组装单 bomSnapshot/consumedLines 不追新（同订单快照原则）
// ④ 幂等：同 assemblyId 重放 409·不双扣 ⑤ 料不足全单回滚（宁不动账勿错账）⑥ RBAC 默认拒（外包 403）。

const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const SUPER = 'super-admin-key-123'
const OUT = 'outsourced-key-123'
const dctx = (data = {}, agentId = 'admin') => ({ db: getDb(), cloud: null, data, drafts: {}, agentId })
const body = (r) => ({ status: r.statusCode, ...JSON.parse(r.body) })
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then(body)

const TEMPLATE = {
  commonLines: [
    { materialId: 'hook', qtyPerSet: 1 },
    { materialId: 'stuffing', qtyPerSet: 40 },
  ],
  yarnSlots: [
    { tier: 'L', form: 'knotted', qtyPerSet: 1 },
    { tier: 'M', form: 'raw', qtyPerSet: 2 },
  ],
}
const PROFILE = { productId: 'p-duck', yarnColors: { L: 'yellow', M: 'white', S: 'orange' }, packagingMaterialId: 'pkg:p-duck', cardMaterialId: 'card:p-duck' }

// 原料主档直灌（测试铺数据·生产路径经 saveMaterial/adjustStock 已有 scmMaterials.test.js 锁）
const seedMaterials = (stocks = {}) =>
  control.seed(
    'materials',
    Object.entries({
      hook: 100,
      stuffing: 4000,
      'yarn:yellow:L:knotted': 50,
      'yarn:white:M:raw': 100,
      'pkg:p-duck': 60,
      'card:p-duck': 60,
      ...stocks,
    }).map(([_id, stock]) => ({ _id, name: _id, uom: 'count', stock }))
  )

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', caps: ['*'] },
    { _id: 'agent:out1', keyHash: sha(OUT), role: 'outsourced' },
  ])
})

describe('saveBomTemplate / saveBomProfile（配方管理·白名单+契约校验）', () => {
  it('模板保存→getBomSetup 读回（白名单字段·数值整数）', async () => {
    const r = body(await bom.saveBomTemplate(dctx({ template: TEMPLATE })))
    expect(r.status).toBe(200)
    const setup = body(await bom.getBomSetup(dctx()))
    expect(setup.template.commonLines).toEqual(TEMPLATE.commonLines)
    expect(setup.template.yarnSlots).toEqual(TEMPLATE.yarnSlots)
  })

  it('带结仅最大团（M 档 knotted 槽→400）·qtyPerSet 非正整数→400', async () => {
    const badKnot = { ...TEMPLATE, yarnSlots: [{ tier: 'M', form: 'knotted', qtyPerSet: 1 }] }
    expect(body(await bom.saveBomTemplate(dctx({ template: badKnot }))).status).toBe(400)
    const badQty = { ...TEMPLATE, commonLines: [{ materialId: 'hook', qtyPerSet: 1.5 }] }
    expect(body(await bom.saveBomTemplate(dctx({ template: badQty }))).status).toBe(400)
  })

  it('差异位保存（_id=productId）→读回；三色/专属件必填', async () => {
    const r = body(await bom.saveBomProfile(dctx({ profile: PROFILE })))
    expect(r.status).toBe(200)
    const setup = body(await bom.getBomSetup(dctx()))
    expect(setup.profiles).toHaveLength(1)
    expect(setup.profiles[0]._id).toBe('p-duck')
    expect(setup.profiles[0].yarnColors).toEqual(PROFILE.yarnColors)
    const noColor = { ...PROFILE, yarnColors: { L: 'yellow', M: '', S: 'orange' } }
    expect(body(await bom.saveBomProfile(dctx({ profile: noColor }))).status).toBe(400)
  })
})

describe('runAssembly（组装执行·门3→快照→门1→门4·守卫 bom-snapshot-frozen）', () => {
  beforeEach(async () => {
    seedMaterials()
    await bom.saveBomTemplate(dctx({ template: TEMPLATE }))
    await bom.saveBomProfile(dctx({ profile: PROFILE }))
  })

  it('执行：扣原料（assembly_out 流水）+ 入成品（inventory + assembly_in 留痕）+ 单据存快照', async () => {
    const r = body(await asm.runAssembly(dctx({ assemblyId: 'as1', productId: 'p-duck', spec: '基础款', sets: 10 }, 'admin')))
    expect(r.status).toBe(200)
    // 原料按 resolveBom 扣：hook 10 / stuffing 400 / L带结 10 / M原 20 / 包装 10 / 卡片 10
    const mat = Object.fromEntries(control.dump('materials').map((m) => [m._id, m.stock]))
    expect(mat.hook).toBe(90)
    expect(mat.stuffing).toBe(3600)
    expect(mat['yarn:yellow:L:knotted']).toBe(40)
    expect(mat['yarn:white:M:raw']).toBe(80)
    expect(mat['pkg:p-duck']).toBe(50)
    expect(mat['card:p-duck']).toBe(50)
    // 成品账（门4 produceStock·无文档则建）
    const inv = control.dump('inventory').find((d) => d._id === 'p-duck__基础款')
    expect(inv.stock).toBe(10)
    // 流水：6 条 assembly_out + 1 条 assembly_in（fg 行只留痕不动 materials）
    const rows = control.dump('stockLedger')
    expect(rows.filter((l) => l.docType === 'assembly_out')).toHaveLength(6)
    const fgIn = rows.find((l) => l.docType === 'assembly_in')
    expect(fgIn._id).toBe('assembly_in:as1:fg:p-duck__基础款')
    expect(fgIn.delta).toBe(10)
    // 单据：快照 + 用料 + 操作者
    const doc = control.dump('assemblyOrders').find((d) => d._id === 'as1')
    expect(doc.sets).toBe(10)
    expect(doc.bomSnapshot.template.yarnSlots).toEqual(TEMPLATE.yarnSlots)
    expect(doc.consumedLines.find((l) => l.materialId === 'stuffing').qty).toBe(400)
    expect(doc.operator).toBe('admin')
  })

  it('快照冻结（bom-snapshot-frozen）：改模板后历史单 bomSnapshot/consumedLines 不追新', async () => {
    await asm.runAssembly(dctx({ assemblyId: 'as1', productId: 'p-duck', spec: '', sets: 5 }))
    const changed = { ...TEMPLATE, commonLines: [{ materialId: 'hook', qtyPerSet: 3 }] }
    expect(body(await bom.saveBomTemplate(dctx({ template: changed }))).status).toBe(200)
    const doc = control.dump('assemblyOrders').find((d) => d._id === 'as1')
    expect(doc.bomSnapshot.template.commonLines).toEqual(TEMPLATE.commonLines) // 历史快照不追新
    expect(doc.consumedLines.find((l) => l.materialId === 'hook').qty).toBe(5) // 按旧模板扣的量
  })

  it('幂等：同 assemblyId 重放→409 DUPLICATE·不双扣', async () => {
    await asm.runAssembly(dctx({ assemblyId: 'as1', productId: 'p-duck', spec: '', sets: 5 }))
    const replay = body(await asm.runAssembly(dctx({ assemblyId: 'as1', productId: 'p-duck', spec: '', sets: 5 })))
    expect(replay.status).toBe(409)
    expect(replay.error).toBe('DUPLICATE')
    expect(control.dump('materials').find((m) => m._id === 'hook').stock).toBe(95) // 只扣一次
    expect(control.dump('inventory').find((d) => d._id === 'p-duck__').stock).toBe(5)
  })

  it('料不足→409 INSUFFICIENT 带短缺料号·全单回滚（原料/成品/单据全不动）', async () => {
    // 60 套：hook/stuffing 先扣得动、L 带结只有 50 → 中途短缺，前面已扣行须回滚（宁不动账勿错账）
    const r = body(await asm.runAssembly(dctx({ assemblyId: 'as2', productId: 'p-duck', spec: '', sets: 60 })))
    expect(r.status).toBe(409)
    expect(r.error).toBe('INSUFFICIENT')
    expect(r.materialId).toBe('yarn:yellow:L:knotted')
    expect(control.dump('materials').find((m) => m._id === 'hook').stock).toBe(100) // 已扣行回滚
    expect(control.dump('inventory')).toHaveLength(0)
    expect(control.dump('assemblyOrders')).toHaveLength(0) // claim 撤回·可重试
    expect(control.dump('stockLedger')).toHaveLength(0)
  })

  it('成品已有库存则累加；不限量（stock=null）保持不限量不翻限量', async () => {
    control.seed('inventory', [
      { _id: 'p-duck__A', productId: 'p-duck', spec: 'A', stock: 7 },
      { _id: 'p-duck__B', productId: 'p-duck', spec: 'B', stock: null },
    ])
    await asm.runAssembly(dctx({ assemblyId: 'as3', productId: 'p-duck', spec: 'A', sets: 3 }))
    expect(control.dump('inventory').find((d) => d._id === 'p-duck__A').stock).toBe(10)
    await asm.runAssembly(dctx({ assemblyId: 'as4', productId: 'p-duck', spec: 'B', sets: 3 }))
    expect(control.dump('inventory').find((d) => d._id === 'p-duck__B').stock).toBe(null)
  })

  it('无模板/无差异位→400 fail-closed；sets 非正整数→400', async () => {
    expect(body(await asm.runAssembly(dctx({ assemblyId: 'x', productId: 'ghost', spec: '', sets: 1 }))).error).toBe('NO_PROFILE')
    expect(body(await asm.runAssembly(dctx({ assemblyId: 'x', productId: 'p-duck', spec: '', sets: 0 }))).error).toBe('BAD_SETS')
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER) }])
    seedMaterials()
    await bom.saveBomProfile(dctx({ profile: PROFILE }))
    expect(body(await asm.runAssembly(dctx({ assemblyId: 'x', productId: 'p-duck', spec: '', sets: 1 }))).error).toBe('NO_TEMPLATE')
  })

  it('previewAssembly（只读预演）：用料×库存对照·不动账', async () => {
    const r = body(await asm.previewAssembly(dctx({ productId: 'p-duck', sets: 200 })))
    expect(r.status).toBe(200)
    const hook = r.lines.find((l) => l.materialId === 'hook')
    expect(hook.need).toBe(200)
    expect(hook.stock).toBe(100)
    expect(hook.short).toBe(100)
    expect(control.dump('stockLedger')).toHaveLength(0) // 只读
  })

  it('listAssemblies：按时间倒序·bounded', async () => {
    await asm.runAssembly(dctx({ assemblyId: 'a1', productId: 'p-duck', spec: '', sets: 1 }))
    await asm.runAssembly(dctx({ assemblyId: 'a2', productId: 'p-duck', spec: '', sets: 2 }))
    const r = body(await asm.listAssemblies(dctx({ limit: 1 })))
    expect(r.list).toHaveLength(1)
  })
})

describe('RBAC 默认拒（门5：未登记 ACTION_CAPS＝admin:write·仅超管）', () => {
  it('外包账号调 SCM-C action → 403；超管 → 过闸', async () => {
    for (const a of ['getBomSetup', 'saveBomTemplate', 'saveBomProfile', 'runAssembly', 'previewAssembly', 'listAssemblies']) {
      expect((await call(a, OUT)).status, `外包 ${a} 应 403`).toBe(403)
    }
    expect((await call('getBomSetup', SUPER)).status).toBe(200)
  })
})
