import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import cloud, { control } from 'wx-server-sdk'
import { getCustomer360, searchCustomer, getUser } from '../../packages/cloud/src/functions/admin/adminApi/actions/customer360'
import { enabledProviders } from '../../packages/cloud/src/functions/admin/adminApi/customer360/registry'
import { profileProvider } from '../../packages/cloud/src/functions/admin/adminApi/customer360/providers/profile'
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
  it('按 openid 聚合画像+订单+激活三面板（经 registry·bounded·只本人数据）', async () => {
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
    // 画像 rollup（B1.3）：只计已付（o1 paid 100·o2 pending 不计）→ totalSpent 100·进课率 1/2=50%
    expect(byKey.profile.data.orderCount).toBe(2)
    expect(byKey.profile.data.paidCount).toBe(1)
    expect(byKey.profile.data.totalSpent).toBe(100)
    expect(byKey.profile.data.enterRate).toBe(50)
    expect(r.panels.map((p) => p.key)).toEqual(['profile', 'orders', 'activation']) // 按 order 排序（profile 5/orders 10/activation 20）
  })

  it('openid 缺失 → BAD_ARGS', async () => {
    const r = parse(await getCustomer360(ctx({})))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('BAD_ARGS')
  })

  it('feature-flag 可关板块（铁律四·config 覆盖 enabled）', async () => {
    control.seed('config', [{ _id: 'csModules', modules: { activation: { enabled: false } } }])
    const provs = await enabledProviders(db)
    expect(provs.map((p) => p.key)).toEqual(['profile', 'orders']) // activation 被 config 关掉·不进聚合
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

// ── B1.3 画像 rollup provider（车道 A·铁律三·从 orders/activations/events 派生·bounded）──
describe('画像 provider profile（B1.3）', () => {
  it('fetch 派生：总消费(仅已付)/单数/激活进课率/最近活跃（只本人）', async () => {
    control.seed('orders', [
      { _id: 'o1', _openid: 'A', status: 'paid', amount: 100, createdAt: 1 },
      { _id: 'o2', _openid: 'A', status: 'shipped', amount: 30, createdAt: 2 },
      { _id: 'o3', _openid: 'A', status: 'pending', amount: 999, createdAt: 3 }, // 未付·不计入 totalSpent
      { _id: 'o4', _openid: 'B', status: 'paid', amount: 7, createdAt: 4 }, // 别人的·不该出现
    ])
    control.seed('activations', [
      { _id: 'a1', _openid: 'A', courseId: 'k1', enteredAt: 50 },
      { _id: 'a2', _openid: 'A', courseId: 'k2', enteredAt: null },
      { _id: 'a3', _openid: 'A', courseId: 'k3', enteredAt: 60 },
    ])
    control.seed('events', [
      { _id: 'e1', _openid: 'A', type: 'watch_at', createdAt: 1000 },
      { _id: 'e2', _openid: 'A', type: 'segment_done', createdAt: 9999 }, // 最近一条
    ])
    const d = await profileProvider.fetch(db, 'A')
    expect(d.orderCount).toBe(3) // A 的三单（不含 B）
    expect(d.paidCount).toBe(2) // paid + shipped
    expect(d.totalSpent).toBe(130) // 100+30·pending 999 不计（元口径）
    expect(d.ordersCapped).toBe(false)
    expect(d.activatedCount).toBe(3)
    expect(d.enteredCount).toBe(2)
    expect(d.enterRate).toBe(67) // 2/3 四舍五入
    expect(d.lastActiveAt).toBe(9999) // events 最近一条
  })

  it('画像 provider 已注册且默认开（registry·铁律一/四）', async () => {
    const provs = await enabledProviders(db)
    expect(provs.map((p) => p.key)).toContain('profile')
    expect(profileProvider.enabled).toBe(true)
  })

  it('空客人：零值不报错（错误隔离·空态）', async () => {
    const d = await profileProvider.fetch(db, 'ghost')
    expect(d.orderCount).toBe(0)
    expect(d.totalSpent).toBe(0)
    expect(d.enterRate).toBe(0)
    expect(d.lastActiveAt).toBe(null)
  })
})

// ── B1.2 客户检索 + 单人画像（车道 A·同属 360 越权读·§1.5）──
describe('客户检索 searchCustomer（B1.2·精确命中四键）', () => {
  beforeEach(() => {
    control.seed('users', [
      { _id: 'A', _openid: 'A', nickname: '小棉', phone: '13800000001', avatar: 'cloud://a', createdAt: 100 },
      { _id: 'B', _openid: 'B', nickname: '阿鸭', phone: '13900000002', createdAt: 200 },
    ])
    control.seed('orders', [{ _id: 'ORD-1', id: 'ORD-1', _openid: 'B', status: 'paid', amount: 30, createdAt: 300 }])
  })

  it('按 openid 精确命中（返摘要 + matchedBy）', async () => {
    const r = parse(await searchCustomer(ctx({ q: 'A' })))
    expect(r.ok).toBe(true)
    expect(r.customers.map((c) => c.openid)).toEqual(['A'])
    expect(r.customers[0].matchedBy).toContain('openid')
    expect(r.customers[0].nickname).toBe('小棉')
  })

  it('按手机号精确命中', async () => {
    const r = parse(await searchCustomer(ctx({ q: '13900000002' })))
    expect(r.customers.map((c) => c.openid)).toEqual(['B'])
    expect(r.customers[0].matchedBy).toContain('phone')
  })

  it('按昵称精确命中', async () => {
    const r = parse(await searchCustomer(ctx({ q: '阿鸭' })))
    expect(r.customers.map((c) => c.openid)).toEqual(['B'])
    expect(r.customers[0].matchedBy).toContain('nickname')
  })

  it('按订单号反查客户（orders→_openid）', async () => {
    const r = parse(await searchCustomer(ctx({ q: 'ORD-1' })))
    expect(r.customers.map((c) => c.openid)).toEqual(['B'])
    expect(r.customers[0].matchedBy).toContain('orderId')
  })

  it('q 缺失 → BAD_ARGS', async () => {
    const r = parse(await searchCustomer(ctx({ q: '  ' })))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('BAD_ARGS')
  })

  it('无匹配 → 空列表（不报错）', async () => {
    const r = parse(await searchCustomer(ctx({ q: 'nobody' })))
    expect(r.ok).toBe(true)
    expect(r.count).toBe(0)
  })
})

describe('单客户画像 getUser（B1.2）', () => {
  it('返回白名单画像（按 _openid 命中·兼容老随机 _id 档）', async () => {
    control.seed('users', [
      { _id: 'rnd-xyz', _openid: 'A', nickname: '小棉', phone: '138', bio: 'hi', createdAt: 1, updatedAt: 2 },
    ])
    const r = parse(await getUser(ctx({ openid: 'A' })))
    expect(r.ok).toBe(true)
    expect(r.user.openid).toBe('A')
    expect(r.user.nickname).toBe('小棉')
    expect(r.user.bio).toBe('hi')
    expect(r.user._id).toBeUndefined() // 白名单·不回原始档字段
  })

  it('无档 → user:null（不报错）', async () => {
    const r = parse(await getUser(ctx({ openid: 'ghost' })))
    expect(r.ok).toBe(true)
    expect(r.user).toBe(null)
  })

  it('openid 缺失 → BAD_ARGS', async () => {
    const r = parse(await getUser(ctx({})))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('BAD_ARGS')
  })
})

describe('§1.5 信任边界：searchCustomer/getUser 同闸（B1.2·根因#3）', () => {
  it('cs-360-read-audited：两者强制审计（破 ^get 跳过）', () => {
    expect(shouldAudit('getUser')).toBe(true) // get* 默认跳·FORCE_AUDIT 破例
    expect(shouldAudit('searchCustomer')).toBe(true)
  })

  it('cs-360-rbac-gated：无 customer:view → 403（经 main·两 action）', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['products:edit'] }])
    expect((await call('searchCustomer', KEY, { q: 'A' })).status).toBe(403)
    expect((await call('getUser', KEY, { openid: 'A' })).status).toBe(403)
  })

  it('经 main 分发留痕 auditLog（搜了什么/查了谁·FORCE_AUDIT）', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['*'] }])
    control.seed('users', [{ _id: 'A', _openid: 'A', nickname: '小棉' }])
    await call('searchCustomer', KEY, { q: 'A' })
    await call('getUser', KEY, { openid: 'A' })
    const sLog = await db.collection('auditLog').where({ action: 'searchCustomer' }).get()
    const gLog = await db.collection('auditLog').where({ action: 'getUser' }).get()
    expect(sLog.data.length).toBeGreaterThanOrEqual(1)
    expect(sLog.data[0].summary.q).toBe('A') // 留痕搜了什么
    expect(gLog.data.length).toBeGreaterThanOrEqual(1)
    expect(gLog.data[0].summary.openid).toBe('A') // 留痕查了谁
  })
})
