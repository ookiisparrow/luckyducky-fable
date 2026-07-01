import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { recordAudit, shouldAudit } from '../../../packages/cloud/src/kit'

// 操作审计#4（根因#3 信任边界可追溯）：管理端动钱/状态操作留痕、凭证剥除、fail-soft。
// 守卫 admin-action-audit-logged 的 reverseTest。

describe('kit.shouldAudit（只记动钱/状态操作）', () => {
  it('动钱/状态操作 → 审计', () => {
    for (const a of ['saveStock', 'shipOrder', 'approveRefund', 'rejectRefund', 'publishProduct', 'clearFeeMismatch', 'createBatch', 'saveSettings'])
      expect(shouldAudit(a)).toBe(true)
  })
  it('只读 / 上传 / 认证 → 跳过（免噪声）', () => {
    for (const a of ['listInventory', 'listOrders', 'getDashboard', 'getSettings', 'uploadImage', 'uploadChunk', 'ping', 'login'])
      expect(shouldAudit(a)).toBe(false)
  })
})

describe('kit.recordAudit（写痕·剥凭证·fail-soft）', () => {
  beforeEach(() => control.reset())

  it('写一条 auditLog：含 action/ok/operator；凭证字段被剥、非敏感保留', async () => {
    await recordAudit({
      action: 'saveSettings',
      ip: '1.2.3.4',
      ok: true,
      data: {
        urlPrefix: 'https://x/',
        alertWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret',
        key: 'PWD',
      },
    })
    const rows = control.dump('auditLog')
    expect(rows.length).toBe(1)
    const e = rows[0]
    expect(e.action).toBe('saveSettings')
    expect(e.ok).toBe(true)
    expect(e.operator).toBe('admin') // 未传 operator → 回退 admin（fail-soft·向后兼容）
    expect(e.summary.urlPrefix).toBe('https://x/') // 非敏感保留
    expect(e.summary.alertWebhook).toBeUndefined() // 凭证剥除
    expect(e.summary.key).toBeUndefined()
  })

  it('operator 贯入 → 记真实操作者身份（B5.4·§1.5 多账号可追溯·非糊成 admin）', async () => {
    await recordAudit({ action: 'approveRefund', operator: 'agent-lin', ip: '1.2.3.4', ok: true, data: { id: 'a1' } })
    const e = control.dump('auditLog')[0]
    expect(e.operator).toBe('agent-lin') // 谁查/改了谁：记真实账号身份、不再糊成单口令 admin
  })

  it('fail-soft：调用不向上抛（审计不反噬业务）', async () => {
    let threw = false
    try {
      await recordAudit({ action: 'shipOrder', ok: false, error: 'X', data: { id: 'o1' } })
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(control.dump('auditLog')[0].error).toBe('X')
  })
})
