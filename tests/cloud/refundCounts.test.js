import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// 售后退款计数/筛选/搜索失真（根因#7 规模·分页）：与订单同病——标签计数 + 状态筛选 + 订单号搜索
// 须服务端精确（count + where），不从「已加载页」推断。本套即守卫 admin-refunds-server-side 的行为锁
// （reverseTest：refundCounts 改数已加载页 / listRefunds 忽略 status → 立红）。
const KEY = 'rc-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
async function call(action, data = {}) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key: KEY, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}

// 跨「一页」规模播种：每状态条数不同；appliedAt 组内严格递增（base+i）→ 游标分页不跨页错位。
function seedAfterSales() {
  const mk = (n, status) =>
    Array.from({ length: n }, (_, i) => ({
      _id: `${status}-${i}`,
      orderId: `LD${status}${i}`,
      status,
      _openid: `b${i}`,
      name: '钩织包',
      spec: '',
      qty: 1,
      refundAmount: 100 + i,
      reason: '尺寸买错了',
      addressName: '张三',
      phone: '13800000000',
      appliedAt: 1_700_000_000_000 + i,
    }))
  control.seed('afterSales', [
    ...mk(4, 'applied'),
    ...mk(2, 'approved'),
    ...mk(9, 'refunded'),
    ...mk(3, 'rejected'),
  ])
}

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
})

describe('refundCounts 按状态服务端精确计数（计数失真·根因#7）', () => {
  it('返回每状态精确计数 + 全部总数（不受分页影响）', async () => {
    seedAfterSales()
    const r = await call('refundCounts')
    expect(r.ok).toBe(true)
    expect(r.counts).toEqual({ applied: 4, approved: 2, refunded: 9, rejected: 3, all: 18 })
  })
  it('空集合返回全 0', async () => {
    const r = await call('refundCounts')
    expect(r.ok).toBe(true)
    expect(r.counts.all).toBe(0)
    expect(r.counts.applied).toBe(0)
  })
})

describe('listRefunds 服务端按状态筛选（筛选失真·根因#7）', () => {
  it('status=applied 只返回待审核单', async () => {
    seedAfterSales()
    const r = await call('listRefunds', { status: 'applied', limit: 50 })
    expect(r.ok).toBe(true)
    expect(r.list.length).toBe(4)
    expect(r.list.every((a) => a.status === 'applied')).toBe(true)
  })
  it('status=all / 不传 = 全部', async () => {
    seedAfterSales()
    const r = await call('listRefunds', { limit: 50 })
    expect(r.list.length).toBe(18)
  })
  it('筛选在服务端 + 分页：refunded 9 条按页取，翻页拿全（不漏·根因#7）', async () => {
    seedAfterSales()
    const p1 = await call('listRefunds', { status: 'refunded', limit: 4 })
    expect(p1.list.length).toBe(4)
    expect(p1.hasMore).toBe(true)
    const p2 = await call('listRefunds', { status: 'refunded', limit: 4, cursor: p1.nextCursor })
    const p3 = await call('listRefunds', { status: 'refunded', limit: 4, cursor: p2.nextCursor })
    const ids = new Set([...p1.list, ...p2.list, ...p3.list].map((a) => a._id))
    expect(ids.size).toBe(9)
    expect([...ids].every((id) => id.startsWith('refunded-'))).toBe(true)
  })
})

describe('listRefunds 服务端按订单号搜索（搜索·根因#7）', () => {
  it('q=订单号 精确命中该单的售后', async () => {
    seedAfterSales()
    const r = await call('listRefunds', { q: 'LDrefunded3' })
    expect(r.ok).toBe(true)
    expect(r.list.length).toBe(1)
    expect(r.list[0].orderId).toBe('LDrefunded3')
  })
  it('q 搜索无视当前状态标签（搜全部状态）', async () => {
    seedAfterSales()
    const r = await call('listRefunds', { status: 'applied', q: 'LDrejected1' })
    expect(r.list.length).toBe(1)
    expect(r.list[0].orderId).toBe('LDrejected1')
  })
  it('q=不存在订单号 返回空', async () => {
    seedAfterSales()
    const r = await call('listRefunds', { q: 'LDnope999' })
    expect(r.list.length).toBe(0)
  })
})
