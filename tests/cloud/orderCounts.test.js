import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// 计数/筛选/搜索失真（根因#7 规模·分页）：管理端订单标签计数 + 状态筛选 + 单号搜索须服务端精确
// （count + where），不从「已加载页」推断——否则分页后计数少算、切状态漏单。
// 本套即守卫 admin-orders-server-side 的行为锁（reverseTest：orderCounts 改数已加载页 /
// listOrders 忽略 status → 立红）。
const KEY = 'oc-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
async function call(action, data = {}) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key: KEY, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}

// 跨「一页」规模播种：每状态条数不同，刻意超过前端任何「已加载页」朴素计数能命中的范围。
// createdAt 在每个状态组内严格递增（base+i）→ 游标分页不会因同值并列跨页错位。
function seedOrders() {
  const mk = (n, status) =>
    Array.from({ length: n }, (_, i) => ({
      _id: `${status}-${i}`,
      id: `${status}-${i}`,
      status,
      _openid: `b${i}`,
      amount: 10000 + i,
      createdAt: 1_700_000_000_000 + i,
      items: [{ name: '钩织包', qty: 1 }],
      address: { name: '张三', phone: '13800000000' },
    }))
  control.seed('orders', [
    ...mk(3, 'pending'),
    ...mk(7, 'paid'),
    ...mk(5, 'shipped'),
    ...mk(11, 'done'),
    ...mk(2, 'closed'),
  ])
}

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
})

describe('orderCounts 按状态服务端精确计数（计数失真·根因#7）', () => {
  it('返回每状态精确计数 + 全部总数（不受分页影响）', async () => {
    seedOrders()
    const r = await call('orderCounts')
    expect(r.ok).toBe(true)
    expect(r.counts).toEqual({ pending: 3, paid: 7, shipped: 5, done: 11, closed: 2, all: 28 })
  })
  it('空集合返回全 0', async () => {
    const r = await call('orderCounts')
    expect(r.ok).toBe(true)
    expect(r.counts.all).toBe(0)
    expect(r.counts.paid).toBe(0)
  })
})

describe('listOrders 服务端按状态筛选（筛选失真·根因#7）', () => {
  it('status=paid 只返回 paid 单（不把别状态混进来）', async () => {
    seedOrders()
    const r = await call('listOrders', { status: 'paid', limit: 50 })
    expect(r.ok).toBe(true)
    expect(r.list.length).toBe(7)
    expect(r.list.every((o) => o.status === 'paid')).toBe(true)
  })
  it('status=all / 不传 = 全部', async () => {
    seedOrders()
    const r = await call('listOrders', { limit: 50 })
    expect(r.list.length).toBe(28)
  })
  it('筛选在服务端 + 分页：done 11 条按页取，翻页拿全（不漏·根因#7）', async () => {
    seedOrders()
    const p1 = await call('listOrders', { status: 'done', limit: 5 })
    expect(p1.list.length).toBe(5)
    expect(p1.hasMore).toBe(true)
    const p2 = await call('listOrders', { status: 'done', limit: 5, cursor: p1.nextCursor })
    const p3 = await call('listOrders', { status: 'done', limit: 5, cursor: p2.nextCursor })
    const ids = new Set([...p1.list, ...p2.list, ...p3.list].map((o) => o._id))
    expect(ids.size).toBe(11)
    expect([...ids].every((id) => id.startsWith('done-'))).toBe(true)
  })
})

describe('listOrders 服务端按单号搜索（搜索·根因#7）', () => {
  it('q=完整单号 精确命中该单', async () => {
    seedOrders()
    const r = await call('listOrders', { q: 'done-9' })
    expect(r.ok).toBe(true)
    expect(r.list.length).toBe(1)
    expect(r.list[0]._id).toBe('done-9')
  })
  it('q 搜索无视当前状态标签（搜全部状态）', async () => {
    seedOrders()
    const r = await call('listOrders', { status: 'paid', q: 'closed-1' })
    expect(r.list.length).toBe(1)
    expect(r.list[0]._id).toBe('closed-1')
  })
  it('q=不存在单号 返回空', async () => {
    seedOrders()
    const r = await call('listOrders', { q: 'nope-999' })
    expect(r.list.length).toBe(0)
  })
})
