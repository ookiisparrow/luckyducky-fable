import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import cloud, { control } from 'wx-server-sdk'
import { getCustomer360 } from '../../packages/cloud/src/functions/admin/adminApi/actions/customer360'
import { enabledProviders } from '../../packages/cloud/src/functions/admin/adminApi/customer360/registry'
import { shouldAudit } from '../../packages/cloud/src/kit/audit'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// 后台360工作站 B1.1：客户360 只读聚合 + 模块框架（铁律三 provider 模式）+ §1.5 信任边界（越权读·根因#3）。
const db = cloud.database()
const ctx = (data) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const KEY = 'test-admin-key-123'
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then((res) => ({
    status: res.statusCode,
    ...JSON.parse(res.body),
  }))

beforeEach(() => control.reset())

describe('客户360 编排器 + provider（B1.1·铁律三）', () => {
  it('按 openid 聚合订单+激活两面板（经 registry·bounded·只本人数据）', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'A', status: 'paid', amount: 100, createdAt: 2000, items: [{}], shipping: { trackingNo: 'T1' } },
      { _id: 'o2', id: 'o2', _openid: 'A', status: 'pending', amount: 50, createdAt: 3000, items: [] },
      { _id: 'o3', id: 'o3', _openid: 'B', status: 'paid', amount: 9, createdAt: 1000, items: [] }, // 别人的·不该出现
    ])
    control.seed('activations', [
      { _id: 'c1', _openid: 'A', courseId: 'k1', enteredAt: 5000 },
      { _id: 'c2', _openid: 'A', courseId: 'k2', enteredAt: null },
      { _id: 'c3', _openid: 'B', courseId: 'k1', enteredAt: null }, // 别人的
    ])
    const r = parse(await getCustomer360(ctx({ openid: 'A' })))
    expect(r.ok).toBe(true)
    expect(r.openid).toBe('A')
    const byKey = Object.fromEntries(r.panels.map((p) => [p.key, p]))
    expect(byKey.orders.data.count).toBe(2) // 只 A 的两单
    expect(byKey.orders.data.orders[0].id).toBe('o2') // createdAt desc：3000 在前
    expect(byKey.orders.data.orders.find((o) => o.id === 'o1').trackingNo).toBe('T1')
    expect(byKey.activation.data.count).toBe(2)
    expect(byKey.activation.data.activations.find((a) => a.courseId === 'k1').entered).toBe(true)
    expect(byKey.activation.data.activations.find((a) => a.courseId === 'k2').entered).toBe(false)
    expect(r.panels.map((p) => p.key)).toEqual(['orders', 'activation', 'learning']) // 按 order 排序（B2.1 加学习位置）
  })

  it('openid 缺失 → BAD_ARGS', async () => {
    const r = parse(await getCustomer360(ctx({})))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('BAD_ARGS')
  })

  it('feature-flag 可关板块（铁律四·config 覆盖 enabled）', async () => {
    control.seed('config', [{ _id: 'csModules', modules: { activation: { enabled: false } } }])
    const provs = await enabledProviders(db)
    expect(provs.map((p) => p.key)).toEqual(['orders', 'learning']) // activation 被 config 关掉·不进聚合（learning 仍开·B2.1）
  })

  it('无数据客人：面板结构齐全·空集不报错（错误隔离）', async () => {
    const r = parse(await getCustomer360(ctx({ openid: 'Z' })))
    expect(r.panels.length).toBe(3)
    expect(r.panels.every((p) => !p.error)).toBe(true)
    const byKey = Object.fromEntries(r.panels.map((p) => [p.key, p]))
    expect(byKey.orders.data.count).toBe(0)
  })
})

describe('§1.5 信任边界（B1.1·根因#3·360 读越权面）', () => {
  it('cs-360-read-audited：getCustomer360 强制审计（破 ^get 跳过）', () => {
    expect(shouldAudit('getCustomer360')).toBe(true) // FORCE_AUDIT 破例
    expect(shouldAudit('getOrderDetail')).toBe(false) // 普通 get* 仍跳过（降噪）
    expect(shouldAudit('approveRefund')).toBe(true) // 动作类照记
  })

  it('cs-360-rbac-gated：无 customer:view 能力 → 403 FORBIDDEN', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['products:edit'] }])
    const r = await call('getCustomer360', KEY, { openid: 'A' })
    expect(r.status).toBe(403)
    expect(r.error).toBe('FORBIDDEN')
  })

  it('cs-360-rbac-gated：超管 caps=[*] 过闸（非 403·读到结果）', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['*'] }])
    const r = await call('getCustomer360', KEY, { openid: 'A' })
    expect(r.status).toBe(200)
    expect(r.ok).toBe(true)
  })

  it('360 读经 main 分发会留痕 auditLog（FORCE_AUDIT·查了谁）', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['*'] }])
    await call('getCustomer360', KEY, { openid: 'A' })
    const log = await db.collection('auditLog').where({ action: 'getCustomer360' }).get()
    expect(log.data.length).toBeGreaterThanOrEqual(1)
    expect(log.data[0].summary.openid).toBe('A') // 留痕「查了谁」（防 PII 访问 0 痕）
  })
})
