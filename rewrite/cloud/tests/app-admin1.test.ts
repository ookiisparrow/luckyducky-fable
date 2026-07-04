// 黄金 kit-security §C/§D/§F/§H + admin-misc §三（adminApi 鉴权底座）（守卫 rw-admin1-golden）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi, registries } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { shouldAudit, recordAudit } from '../src/kit'

const post = (payload: Record<string, unknown>, ip = '1.1.1.1') =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify(payload),
  }) as Promise<any>
const bodyOf = (r: any) => JSON.parse(r.body)

const seedSuper = (key = 'super-secret-key') =>
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(key), role: 'superadmin', createdAt: 1 }])

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})
afterEach(() => {
  delete process.env.ADMIN_BOOTSTRAP_KEY
})

describe('HTTP 外壳（黄金 admin-misc §二）', () => {
  it('大白话：预检 204、非 POST 405、坏 JSON 400、探针免口令', async () => {
    expect((await adminApi({ httpMethod: 'OPTIONS' })).statusCode).toBe(204)
    expect((await adminApi({ httpMethod: 'GET' })).statusCode).toBe(405)
    expect((await adminApi({ httpMethod: 'POST', body: '{坏json' })).statusCode).toBe(400)
    const ping = await post({ action: 'ping' })
    expect(bodyOf(ping).ok).toBe(true)
  })
})

describe('首登引导与口令闸（黄金 admin-misc §三·关抢占窗口）', () => {
  it('大白话：空库时必须匹配部署密钥才能首设口令——未配密钥禁引导、不匹配拒；设定后其他口令一律被拒', async () => {
    // 未配部署密钥：空库任何口令都进不来（杜绝谁先登录谁当管理员）
    expect((await post({ action: 'login', key: 'anything-long' })).statusCode).toBe(401)

    process.env.ADMIN_BOOTSTRAP_KEY = 'deploy-secret-1'
    expect((await post({ action: 'login', key: 'wrong-guess-1' }, '2.2.2.2')).statusCode).toBe(401)
    const ok = await post({ action: 'login', key: 'deploy-secret-1' }, '3.3.3.3')
    expect(ok.statusCode).toBe(200)
    expect(bodyOf(ok).bootstrapped).toBe(true)
    expect(bodyOf(ok).sessionToken).toBeTruthy()

    // 已设口令后：bootstrap 密钥不再是万能钥匙以外的口令都拒（关抢占窗口）
    expect((await post({ action: 'login', key: 'another-key-x' }, '4.4.4.4')).statusCode).toBe(401)
  })

  it('大白话：口令登录成功签发高熵令牌；库里只存哈希绝不存明文；过短口令直接拒', async () => {
    seedSuper()
    expect((await post({ action: 'login', key: 'abc' })).statusCode).toBe(401) // 过短
    const r = await post({ action: 'login', key: 'super-secret-key' })
    expect(r.statusCode).toBe(200)
    const token = bodyOf(r).sessionToken
    expect(token.length).toBe(64) // 32 字节 hex 高熵
    const doc = control.dump('adminConfig')[0]
    expect(JSON.stringify(doc)).not.toContain(token) // 明文不落盘
    expect(doc.sessions[0].hash).toBe(sha(token))
  })
})

describe('认证频控（黄金 kit-security §F·per-IP + 全局兜底）', () => {
  it('大白话：同 IP 连错 5 次锁定——第 6 次即便口令正确也拒；别的 IP 不受影响；成功清计数', async () => {
    seedSuper()
    for (let i = 0; i < 5; i++) await post({ action: 'login', key: 'wrong-key-abc' }, '9.9.9.9')
    const blocked = await post({ action: 'login', key: 'super-secret-key' }, '9.9.9.9')
    expect(blocked.statusCode).toBe(429)
    expect(bodyOf(blocked).retryAfter).toBeGreaterThan(0)
    const other = await post({ action: 'login', key: 'super-secret-key' }, '8.8.8.8')
    expect(other.statusCode).toBe(200) // IP 隔离
  })

  it('大白话：轮换伪造 IP 让 per-IP 永不达阈——跨所有 IP 的全局计数达阈仍锁', async () => {
    seedSuper()
    for (let i = 0; i < 20; i++) await post({ action: 'login', key: 'wrong-key-abc' }, `10.0.0.${i}`)
    const blocked = await post({ action: 'login', key: 'super-secret-key' }, '10.0.0.99')
    expect(blocked.statusCode).toBe(429) // 全局兜底
  })
})

describe('会话令牌（黄金 kit-security §C）', () => {
  it('大白话：令牌可作后续请求凭据（仍受 RBAC）；过期拒；停号立即失效；多设备并存；超容剪最旧', async () => {
    seedSuper()
    const t1 = bodyOf(await post({ action: 'login', key: 'super-secret-key' })).sessionToken
    const t2 = bodyOf(await post({ action: 'login', key: 'super-secret-key' })).sessionToken
    // 两令牌都有效（多设备不互踢）；令牌过鉴权后落到 UNKNOWN_ACTION（业务批未挂载）——非 401 即凭据有效
    expect(bodyOf(await post({ action: 'nonexist', key: t1 })).error).toBe('UNKNOWN_ACTION')
    expect(bodyOf(await post({ action: 'nonexist', key: t2 })).error).toBe('UNKNOWN_ACTION')

    // 超容剪最旧：再登 7 次（共 9 枚）→ 最早的 t1 失效
    for (let i = 0; i < 7; i++) await post({ action: 'login', key: 'super-secret-key' })
    expect((await post({ action: 'nonexist', key: t1 })).statusCode).toBe(401)

    // 过期拒：手工造过期会话
    control.reset()
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin', sessions: [{ hash: sha('TK-EXPIRED-0001'), exp: Date.now() - 1000, via: 'pwd', at: 1 }] },
    ])
    const exp = await post({ action: 'nonexist', key: 'TK-EXPIRED-0001' })
    expect(exp.statusCode).toBe(401)
    expect(bodyOf(exp).error).toBe('SESSION_EXPIRED')

    // 停号立即失效（不等过期）
    control.reset()
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' },
      { _id: 'agent-1', keyHash: sha('outsourced-key-1'), role: 'outsourced', disabled: true, sessions: [{ hash: sha('TK-DISABLED-01'), exp: Date.now() + 60_000, via: 'pwd', at: 1 }] },
    ])
    expect(bodyOf(await post({ action: 'nonexist', key: 'TK-DISABLED-01' })).error).toBe('ACCOUNT_DISABLED')
  })
})

describe('RBAC 默认拒（黄金 kit-security §D）', () => {
  it('大白话：外包最小权对未登记 cap 的任何 action 一律 403（令牌≠提权）；超管通配过闸；停号在口令闸即拒', async () => {
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' },
      { _id: 'agent-1', keyHash: sha('outsourced-key-1'), role: 'outsourced', name: '外包一号' },
      { _id: 'agent-2', keyHash: sha('outsourced-key-2'), role: 'outsourced', disabled: true },
    ])
    const forbidden = await post({ action: 'definitelyNotMounted', key: 'outsourced-key-1' })
    expect(forbidden.statusCode).toBe(403) // 默认拒 admin:write

    const superR = await post({ action: 'definitelyNotMounted', key: 'super-secret-key' })
    expect(bodyOf(superR).error).toBe('UNKNOWN_ACTION') // 过闸（业务批未挂载）

    expect(bodyOf(await post({ action: 'definitelyNotMounted', key: 'outsourced-key-2' })).error).toBe('ACCOUNT_DISABLED')
  })

  it('大白话：登记了 cap 的 action 按能力放行——外包持 agent:handle 可过对应闸', async () => {
    registries.ACTION_CAPS.testQueue = 'agent:handle'
    registries.ACTIONS.testQueue = async () => ({ statusCode: 200, headers: {}, body: JSON.stringify({ ok: true }) })
    try {
      control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }, { _id: 'agent-1', keyHash: sha('outsourced-key-1'), role: 'outsourced' }])
      const r = await post({ action: 'testQueue', key: 'outsourced-key-1' })
      expect(r.statusCode).toBe(200)
    } finally {
      delete registries.ACTION_CAPS.testQueue
      delete registries.ACTIONS.testQueue
    }
  })
})

describe('操作审计（黄金 kit-security §H）', () => {
  it('大白话：只审动钱/状态类；只读与上传跳过；360 越权读破例强制留痕', () => {
    expect(shouldAudit('approveRefund')).toBe(true)
    expect(shouldAudit('saveStock')).toBe(true)
    expect(shouldAudit('listOrders')).toBe(false)
    expect(shouldAudit('getDashboard')).toBe(false)
    expect(shouldAudit('uploadImage')).toBe(false)
    expect(shouldAudit('ping')).toBe(false)
    expect(shouldAudit('getCustomer360')).toBe(true) // FORCE_AUDIT
    expect(shouldAudit('searchCustomer')).toBe(true)
  })

  it('大白话：留痕记操作/操作者/成败且剥除凭证类字段；写审计失败绝不反噬业务', async () => {
    await recordAudit({
      action: 'saveSettings',
      operator: '外包一号',
      ip: '1.2.3.4',
      data: { alertWebhook: 'https://secret-hook', key: 'pwd-123', note: '改通知' },
      ok: true,
    })
    const log = control.dump('auditLog')[0]
    expect(log.action).toBe('saveSettings')
    expect(log.operator).toBe('外包一号')
    expect(log.ok).toBe(true)
    const raw = JSON.stringify(log)
    expect(raw).not.toContain('secret-hook') // 凭证剥除
    expect(raw).not.toContain('pwd-123')
    expect(log.summary.note).toBe('改通知')
    await expect(recordAudit({ action: 'x', ok: false })).resolves.toBeUndefined() // fail-soft
  })

  it('大白话：经分发处调用动状态 action 自动留痕（含失败留痕）', async () => {
    seedSuper()
    registries.ACTIONS.saveThing = async () => {
      throw new Error('boom')
    }
    try {
      const r = await post({ action: 'saveThing', key: 'super-secret-key' })
      expect(r.statusCode).toBe(500)
      const log = control.dump('auditLog').find((l: any) => l.action === 'saveThing')
      expect(log.ok).toBe(false)
      expect(log.error).toBe('SERVER_ERROR')
    } finally {
      delete registries.ACTIONS.saveThing
    }
  })
})
