// 人工配置清单守卫（批 B9→2026-07-12 补口可填写化·铁律：只探测状态·零回显任何密钥/配置值）。
//
// 两类守卫：
// ① 源码扫描——configChecklist.ts 里 `process.env` 只允许出现在 `!!`/`Boolean(` 布尔语境（防裸读值），
//    且任何 `.where(...)` 起的查询链只要调了 `.get()` 就必须同链带 `.limit(`（根因#7 有界纪律）。
//    结构抄既有源码扫描型守卫（scm-overview-bounded.test.ts 的 stripComments 范式，防 E1 注释假绿）。
// ② 行为哨兵——mock env + seed DB 塞入 SENTINEL_ 前缀哨兵串，断言 getConfigChecklist 响应体
//    JSON.stringify 后不含任一哨兵串（探测规则只判「配了没」、绝不把探到的值吐回前端）。
//
// 反向自检：① 把 `!!process.env.WXPAY_MCH_PRIVATE_KEY` 手工改回裸 `process.env.WXPAY_MCH_PRIVATE_KEY`
// （去掉 `!!`）→ 源码扫描用例立即红；改回即绿。② 让某一状态判定直接拼回哨兵值（如 `wxkfOk` 改成把
// secureConfig 原文塞进某 item 字段）→ 哨兵用例立即红；改回即绿。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src', 'functions', 'adminApi', 'actions', 'configChecklist.ts')

/** 剥单行注释与块注释（E1 教训：裸写正则会被注释文本假命中）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const raw = readFileSync(SRC, 'utf8')
const body = stripComments(raw)

describe('源码扫描：configChecklist.ts 零回显（process.env 只在布尔语境·查询链有界）', () => {
  it('大白话：全文 process.env 引用只允许紧跟在 !! 或 Boolean( 之后出现，不许裸读值', () => {
    const total = (body.match(/process\.env/g) || []).length
    const safe = (body.match(/(?:!!|Boolean\()process\.env/g) || []).length
    expect(total).toBeGreaterThan(0) // 断言本身没扫空（防正则失效假绿）
    expect(safe).toBe(total)
  })

  it('大白话：任何 db.collection(...).where(...) 起的查询链只要含 .get() 就必须同链带 .limit(', () => {
    const idxs = [...body.matchAll(/db\.collection\(/g)].map((m) => m.index as number)
    expect(idxs.length).toBeGreaterThan(0)
    const chains = idxs.map((start, i) => body.slice(start, i + 1 < idxs.length ? idxs[i + 1] : body.length))
    const whereChains = chains.filter((c) => /\.where\(/.test(c))
    expect(whereChains.length).toBeGreaterThan(0)
    for (const c of whereChains) {
      if (/\.get\(\)/.test(c)) expect(c).toMatch(/\.limit\(/)
    }
  })
})

const SUPER = 'super-secret-key-b9'
const A1 = 'outsourced-key-b9'

const post = (action: string, key: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const ENV_KEYS = ['WXKF_AGENTID', 'WXKF_CORPID', 'WXKF_SECRET', 'WXKF_TOKEN', 'WXKF_AESKEY', 'WXKF_MINIAPP_APPID', 'WXKF_THUMB_MEDIA_ID', 'WXPAY_MCH_PRIVATE_KEY', 'WXPAY_MCH_SERIAL']

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  for (const k of ENV_KEYS) delete process.env[k]
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-b9', keyHash: sha(A1), role: 'outsourced', name: '外包B9' },
  ])
})
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

const groupOf = (groups: any[], name: string) => groups.find((g: any) => g.group === name)
const itemOf = (groups: any[], groupName: string, key: string) => groupOf(groups, groupName)?.items.find((i: any) => i.key === key)

const WXKF_GROUP = '微信客服凭证（本页填写 → 云函数读库自动生效，无需再改环境变量）'
const WXPAY_GROUP = '微信支付对账凭证（本页填写 → 云函数读库自动生效）'
const PAY_GROUP = '支付/退款接缝配置（本页填写 → 云函数读库自动生效）'
const ADMIN_GROUP = 'admin 页内配置（/admin 直达）'

describe('RBAC 默认拒：外包访问 getConfigChecklist 403（未登记 ACTION_CAPS→仅超管）', () => {
  it('大白话：外包 key 调用一律 403', async () => {
    expect((await post('getConfigChecklist', A1, {})).status).toBe(403)
  })
})

describe('探测规则各态：ok / missing / check（超管可读·数据契约 6 组 22 条全在）', () => {
  it('大白话：全部未配置时——凭证/DB 项 missing，纯人工 5 项 + 资产 1 项恒 check', async () => {
    const r = await post('getConfigChecklist', SUPER, {})
    expect(r.status).toBe(200)
    const groups = r.groups
    expect(groups.length).toBe(6)
    const totalItems = groups.reduce((n: number, g: any) => n + g.items.length, 0)
    expect(totalItems).toBe(22) // 22 条全在（铁律·配置清单审查批 +2：小程序卡片 appid/thumbMediaId 随迁入库）

    for (const key of ['WXKF_AGENTID', 'WXKF_CORPID', 'WXKF_SECRET', 'WXKF_TOKEN', 'WXKF_AESKEY', 'WXKF_MINIAPP_APPID', 'WXKF_THUMB_MEDIA_ID']) {
      expect(itemOf(groups, WXKF_GROUP, key).status).toBe('missing')
      expect(itemOf(groups, WXKF_GROUP, key).fill).toBeTruthy() // 可填写元数据必在
    }
    for (const key of ['WXPAY_MCH_PRIVATE_KEY', 'WXPAY_MCH_SERIAL']) {
      expect(itemOf(groups, WXPAY_GROUP, key).status).toBe('missing')
    }
    for (const key of ['pay.mode', 'pay.subMchId', 'pay.flowId', 'pay.refundFlowId']) {
      expect(itemOf(groups, PAY_GROUP, key).status).toBe('missing')
    }

    expect(itemOf(groups, ADMIN_GROUP, 'alertWebhook').status).toBe('missing')
    expect(itemOf(groups, ADMIN_GROUP, 'scmBomTemplate').status).toBe('missing')
    expect(itemOf(groups, ADMIN_GROUP, 'stockInit').status).toBe('missing')

    const humanGroup = groupOf(groups, '企业微信/微信客服/小程序后台（纯人工）')
    expect(humanGroup.items.length).toBe(5)
    for (const it of humanGroup.items) expect(it.status).toBe('check')
    const assetGroup = groupOf(groups, '资产正册')
    expect(assetGroup.items.length).toBe(1)
    expect(assetGroup.items[0].status).toBe('check')
  })

  it('大白话：secureConfig/wxkf 与 wxpay 入库齐全 → 对应 9 项转 ok', async () => {
    control.seed('secureConfig', [
      { _id: 'wxkf', corpId: 'ww123', secret: 's1', token: 't1', aesKey: 'a'.repeat(43), agentId: '1000001', miniappAppId: 'wx0000000000000000', thumbMediaId: 'media-1' },
      { _id: 'wxpay', mchPrivateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n', mchSerial: 'ABCDEF' },
    ])
    const r = await post('getConfigChecklist', SUPER, {})
    const groups = r.groups
    for (const key of ['WXKF_AGENTID', 'WXKF_CORPID', 'WXKF_SECRET', 'WXKF_TOKEN', 'WXKF_AESKEY', 'WXKF_MINIAPP_APPID', 'WXKF_THUMB_MEDIA_ID']) {
      expect(itemOf(groups, WXKF_GROUP, key).status).toBe('ok')
    }
    for (const key of ['WXPAY_MCH_PRIVATE_KEY', 'WXPAY_MCH_SERIAL']) {
      expect(itemOf(groups, WXPAY_GROUP, key).status).toBe('ok')
    }
  })

  it('大白话：WXPAY_MCH_* 未入库但 adminApi 自身环境变量已配 → 不误报 missing（规则②兜底）', async () => {
    process.env.WXPAY_MCH_PRIVATE_KEY = 'legacy-env-key'
    process.env.WXPAY_MCH_SERIAL = 'legacy-serial'
    const r = await post('getConfigChecklist', SUPER, {})
    expect(itemOf(r.groups, WXPAY_GROUP, 'WXPAY_MCH_PRIVATE_KEY').status).toBe('ok')
    expect(itemOf(r.groups, WXPAY_GROUP, 'WXPAY_MCH_SERIAL').status).toBe('ok')
  })

  it('大白话：config/pay 齐全 → 支付接缝 4 项转 ok', async () => {
    control.seed('config', [{ _id: 'pay', mode: 'real', subMchId: '1113881793', flowId: 'flow1', refundFlowId: 'rflow1' }])
    const r = await post('getConfigChecklist', SUPER, {})
    for (const key of ['pay.mode', 'pay.subMchId', 'pay.flowId', 'pay.refundFlowId']) {
      expect(itemOf(r.groups, PAY_GROUP, key).status).toBe('ok')
    }
  })

  it('大白话：admin 页内配置齐全时——3 项转 ok，纯人工恒 check 不受影响', async () => {
    control.seed('adminConfig', [{ _id: 'settings', alertWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x' }])
    control.seed('config', [{ _id: 'scmBomTemplate', commonLines: [], yarnSlots: [{ tier: 'L', form: 'raw', qtyPerSet: 1 }] }])
    control.seed('stockLedger', [{ _id: 'l1', docType: 'adjust', itemKey: 'm1', delta: 5, operator: '', reason: '期初', at: Date.now() }])
    control.seed('materials', [{ _id: 'm1', name: '料一', threshold: 3, stock: 10 }])

    const r = await post('getConfigChecklist', SUPER, {})
    const groups = r.groups
    expect(itemOf(groups, ADMIN_GROUP, 'alertWebhook').status).toBe('ok')
    expect(itemOf(groups, ADMIN_GROUP, 'scmBomTemplate').status).toBe('ok')
    expect(itemOf(groups, ADMIN_GROUP, 'stockInit').status).toBe('ok')
  })

  it('大白话：期初盘点+物料安全线合并一行——只有 adjust 流水没有 threshold 物料仍判 missing（两条件都要满足）', async () => {
    control.seed('stockLedger', [{ _id: 'l1', docType: 'adjust', itemKey: 'm1', delta: 5, operator: '', reason: '期初', at: Date.now() }])
    // 不 seed materials threshold>0
    const r = await post('getConfigChecklist', SUPER, {})
    expect(itemOf(r.groups, ADMIN_GROUP, 'stockInit').status).toBe('missing')
  })
})

describe('哨兵行为测试：密钥/配置值零回显（铁律）', () => {
  it('大白话：env + DB 塞哨兵串后，响应体 JSON.stringify 一律不含任一哨兵串', async () => {
    process.env.WXPAY_MCH_PRIVATE_KEY = 'SENTINEL_WXPAY_KEY_9f3a'
    control.seed('secureConfig', [
      { _id: 'wxkf', corpId: 'SENTINEL_CORPID_9f3a', secret: 'SENTINEL_SECRET_9f3a', token: 'SENTINEL_TOKEN_9f3a', aesKey: 'SENTINEL_AESKEY_9f3a', agentId: 'SENTINEL_AGENTID_9f3a', miniappAppId: 'SENTINEL_MINIAPP_9f3a', thumbMediaId: 'SENTINEL_THUMB_9f3a' },
    ])
    control.seed('config', [{ _id: 'pay', mode: 'real', subMchId: 'SENTINEL_MCHID_9f3a', flowId: 'SENTINEL_FLOWID_9f3a', refundFlowId: 'SENTINEL_RFLOWID_9f3a' }])
    control.seed('adminConfig', [{ _id: 'settings', alertWebhook: 'SENTINEL_WEBHOOK_9f3a' }])
    control.seed('config', [{ _id: 'scmBomTemplate', commonLines: [], yarnSlots: [{ tier: 'L', form: 'raw', qtyPerSet: 1 }], sentinelNote: 'SENTINEL_BOM_9f3a' }])
    control.seed('stockLedger', [{ _id: 'l1', docType: 'adjust', itemKey: 'm1', delta: 5, operator: '', reason: 'SENTINEL_REASON_9f3a', at: Date.now() }])
    control.seed('materials', [{ _id: 'm1', name: 'SENTINEL_MATERIAL_9f3a', threshold: 3, stock: 10 }])

    const r = await post('getConfigChecklist', SUPER, {})
    const stringified = JSON.stringify(r)
    for (const sentinel of [
      'SENTINEL_WXPAY_KEY_9f3a',
      'SENTINEL_CORPID_9f3a',
      'SENTINEL_SECRET_9f3a',
      'SENTINEL_TOKEN_9f3a',
      'SENTINEL_AESKEY_9f3a',
      'SENTINEL_AGENTID_9f3a',
      'SENTINEL_MINIAPP_9f3a',
      'SENTINEL_THUMB_9f3a',
      'SENTINEL_MCHID_9f3a',
      'SENTINEL_FLOWID_9f3a',
      'SENTINEL_RFLOWID_9f3a',
      'SENTINEL_WEBHOOK_9f3a',
      'SENTINEL_BOM_9f3a',
      'SENTINEL_REASON_9f3a',
      'SENTINEL_MATERIAL_9f3a',
    ]) {
      expect(stringified).not.toContain(sentinel)
    }
  })
})
