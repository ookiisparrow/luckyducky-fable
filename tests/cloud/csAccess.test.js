import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { assertDataShareConsent, assertOwnedByAgent } from '../../packages/cloud/src/kit/csAccess'

// 承面C 车道 C 外包访问控制闸（§1.5·B3.3/B6·根因#3 fail-closed·守卫 cs-data-share-consented / outsourced-reads-scoped）。
const db = cloud.database()
beforeEach(() => control.reset())

describe('assertDataShareConsent（C1·数据共享同意闸·fail-closed）', () => {
  it('未建档/无 csDataShare → ok:false NO_CONSENT（默认拒·非放行）', async () => {
    expect(await assertDataShareConsent(db, 'ghost')).toEqual({ ok: false, error: 'NO_CONSENT' })
  })
  it('空 openid → ok:false（无从识别客户·fail-closed）', async () => {
    expect((await assertDataShareConsent(db, '')).ok).toBe(false)
  })
  it('已撤回（agreed:false）→ ok:false（撤回即拒）', async () => {
    control.seed('users', [{ _id: 'A', _openid: 'A', csDataShare: { agreed: false } }])
    expect((await assertDataShareConsent(db, 'A')).ok).toBe(false)
  })
  it('已同意（agreed:true）→ ok:true（放行）', async () => {
    control.seed('users', [{ _id: 'A', _openid: 'A', csDataShare: { agreed: true, at: 1 } }])
    expect(await assertDataShareConsent(db, 'A')).toEqual({ ok: true })
  })
  it('agreed 非严格 true（如 truthy 1）不放行（防松判·须显式 true）', async () => {
    control.seed('users', [{ _id: 'A', _openid: 'A', csDataShare: { agreed: 1 } }])
    expect((await assertDataShareConsent(db, 'A')).ok).toBe(false)
  })
})

describe('assertOwnedByAgent（C3·外包会话归属 scope 闸·fail-closed·防批量导出）', () => {
  beforeEach(() => {
    control.seed('csSession', [{ _id: 'wxkf:k:u1', agentId: 'agent:me', status: 'active' }])
  })
  it('会话归本坐席 → ok:true 带 session', async () => {
    const r = await assertOwnedByAgent(db, 'agent:me', 'wxkf:k:u1')
    expect(r.ok).toBe(true)
    expect(r.session.agentId).toBe('agent:me')
  })
  it('会话归他人 → ok:false NOT_OWNER（防越 scope 读他人会话）', async () => {
    expect(await assertOwnedByAgent(db, 'agent:other', 'wxkf:k:u1')).toMatchObject({ ok: false, error: 'NOT_OWNER' })
  })
  it('会话不存在 → ok:false NO_SESSION（fail-closed）', async () => {
    expect(await assertOwnedByAgent(db, 'agent:me', 'nope')).toMatchObject({ ok: false, error: 'NO_SESSION' })
  })
  it('缺坐席/会话标识 → ok:false BAD_SCOPE', async () => {
    expect((await assertOwnedByAgent(db, '', 'wxkf:k:u1')).ok).toBe(false)
    expect((await assertOwnedByAgent(db, 'agent:me', '')).ok).toBe(false)
  })
  it('pending 会话（agentId 空）对真坐席 → NOT_OWNER（空对非空不放行·防批量导出未认领会话）', async () => {
    control.seed('csSession', [{ _id: 'wxkf:k:u2', agentId: '', status: 'pending' }])
    expect(await assertOwnedByAgent(db, 'agent:me', 'wxkf:k:u2')).toMatchObject({ ok: false, error: 'NOT_OWNER' })
  })
})
