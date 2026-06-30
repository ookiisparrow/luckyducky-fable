import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'
import { ROLES } from '../../packages/cloud/src/functions/admin/adminApi/lib'

// 坐席 RBAC 默认拒（§1.5·B5.2·别让单超管裸奔）：角色→能力位 + 能力闸默认拒（未登记 action 须高权 cap·
// 外包默认进不去钱/状态）+ 账号开停 disabled + 向后兼容旧超管 doc。守卫 agent-rbac-gated 焊结构·本测试焊行为。
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const SUPER = 'super-admin-key-123'
const OUT = 'outsourced-key-123'
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then((r) => ({
    status: r.statusCode,
    ...JSON.parse(r.body),
  }))
const seedAccts = (extra = []) =>
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', caps: ['*'] },
    { _id: 'agent:out1', keyHash: sha(OUT), role: 'outsourced' },
    ...extra,
  ])

beforeEach(() => {
  control.reset()
  seedAccts()
})

describe('坐席 RBAC 默认拒（B5.2·§1.5）', () => {
  it('ROLES：outsourced 外包最小权·不含全权 *；superadmin 全权', () => {
    expect(ROLES.outsourced).not.toContain('*')
    expect(ROLES.outsourced).toContain('customer:view')
    expect(ROLES.superadmin).toContain('*')
  })

  it('超管全权：360 读 + 钱/状态 action 都过闸（非 403·到 handler）', async () => {
    expect((await call('getCustomer360', SUPER, { openid: 'x' })).status).not.toBe(403)
    for (const a of ['shipOrder', 'approveRefund', 'saveStock', 'publishProduct', 'getDashboard']) {
      expect((await call(a, SUPER)).status, `超管 ${a} 不应 403`).not.toBe(403)
    }
  })

  it('外包 customer:view：360 读/检索过闸（非 403）', async () => {
    expect((await call('getCustomer360', OUT, { openid: 'x' })).status).not.toBe(403)
    expect((await call('searchCustomer', OUT, { q: 'x' })).status).not.toBe(403)
    expect((await call('searchConversations', OUT, {})).status).not.toBe(403)
  })

  it('外包默认拒：未授 cap 的钱/状态/管理 action → 403 FORBIDDEN', async () => {
    for (const a of ['shipOrder', 'approveRefund', 'saveStock', 'publishProduct', 'saveSettings', 'getDashboard', 'saveKb']) {
      const r = await call(a, OUT)
      expect(r.status, `${a} 应被外包默认拒`).toBe(403)
      expect(r.error).toBe('FORBIDDEN')
    }
  })

  it('账号开停：disabled 外包账号 → 拒（ACCOUNT_DISABLED·401）', async () => {
    control.reset()
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin', caps: ['*'] },
      { _id: 'agent:out1', keyHash: sha(OUT), role: 'outsourced', disabled: true },
    ])
    const r = await call('getCustomer360', OUT, { openid: 'x' })
    expect(r.status).toBe(401)
    expect(r.error).toBe('ACCOUNT_DISABLED')
  })

  it('向后兼容：旧超管 auth doc 无 role（仅 caps=[*]）仍全权过闸', async () => {
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), caps: ['*'] }]) // 旧形态·无 role
    expect((await call('shipOrder', SUPER)).status).not.toBe(403)
    expect((await call('getCustomer360', SUPER, { openid: 'x' })).status).not.toBe(403)
  })

  it('错误口令仍 BAD_KEY（多账号查不命中·不误放行）', async () => {
    const r = await call('getCustomer360', 'totally-wrong-key', { openid: 'x' })
    expect(r.status).toBe(401)
  })
})
