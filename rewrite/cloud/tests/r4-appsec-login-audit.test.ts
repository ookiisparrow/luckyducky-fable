// #400-8：登录成功要留一条审计（谁、何时、脱敏后的来源 IP、哪种方式）。
// 写审计失败不能挡登录，但要告警——否则留痕丢了没人知道。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { recordAudit } from '../src/kit'

const SUPER = 'super-secret-key'
const post = (action: string, key: string, data: Record<string, unknown> = {}, ip = '1.2.3.4') =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))
const loginRows = () => control.dump(COLLECTIONS.auditLog).filter((l: any) => l.action === 'login')

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed(COLLECTIONS.adminConfig, [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-1', name: '小王', keyHash: sha('agent-key-1'), role: 'outsourced', wecomUserId: 'w1' },
  ])
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('口令登录成功留痕', () => {
  it('记下谁、何时、IP 只留前三段、方式 pwd；不存完整 IP，也不存口令和令牌', async () => {
    const before = Date.now()
    const r = await post('login', SUPER)
    expect(r.status).toBe(200)
    expect(r.sessionToken).toBeTruthy()
    const rows = loginRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'login', operator: 'admin', ip: '1.2.3.*', summary: { via: 'pwd' }, ok: true })
    expect(rows[0].ts).toBeGreaterThanOrEqual(before)
    const s = JSON.stringify(rows[0])
    expect(s).not.toContain('1.2.3.4')
    expect(s).not.toContain(SUPER)
    expect(s).not.toContain(r.sessionToken)
  })

  it('外包账号：operator 记账号名；IPv6 只留前三组', async () => {
    const r = await post('login', 'agent-key-1', {}, '2001:db8:85a3:8d3:1319:8a2e:370:7348')
    expect(r.status).toBe(200)
    expect(loginRows()[0]).toMatchObject({ operator: '小王', ip: '2001:db8:85a3:*' })
  })

  it('带端口的 IPv4、:: 压缩的 IPv6、认不出的串：都不原样落库', async () => {
    const cases: [string, string][] = [
      ['1.2.3.4:5678', '1.2.3.*'],
      ['2408::1', '2408:*'],
      ['::1', ''],
      ['not-an-ip<script>', ''],
    ]
    for (const [raw, masked] of cases) {
      control.reset()
      control.seed(COLLECTIONS.adminConfig, [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
      expect((await post('login', SUPER, {}, raw)).status).toBe(200)
      expect(loginRows()[0].ip).toBe(masked)
    }
  })

  it('口令错不记登录成功', async () => {
    expect((await post('login', 'wrong-key-xx')).status).toBe(401)
    expect(loginRows()).toHaveLength(0)
  })

  it('审计写失败：登录照常成功拿到令牌，同时打 LOGIN_AUDIT_FAIL 告警', async () => {
    control.setBeforeAdd(({ coll }: { coll: string }) => {
      if (coll === COLLECTIONS.auditLog) throw new Error('DB_DOWN')
    })
    const r = await post('login', SUPER)
    expect(r.status).toBe(200)
    expect(r.sessionToken).toBeTruthy()
    const logged = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(logged).toContain('code=LOGIN_AUDIT_FAIL')
    // 只打日志行等于没人看见：必须进 anomalies 账本（控制台可查、同一通道推企微）
    expect(control.dump(COLLECTIONS.anomalies).some((a: any) => a.code === 'LOGIN_AUDIT_FAIL')).toBe(true)
  })
})

describe('企微免登成功留痕', () => {
  it('方式记 wecom、operator 记绑定账号名', async () => {
    control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
    const saved = globalThis.fetch
    ;(globalThis as any).fetch = async (url: any) => ({
      json: async () => (String(url).includes('auth/getuserinfo') ? { errcode: 0, userid: 'w1' } : { errcode: 0 }),
    })
    try {
      const r = await post('loginByWecomCode', '', { code: 'good-code' }, '9.8.7.6')
      expect(r.status).toBe(200)
    } finally {
      globalThis.fetch = saved
    }
    expect(loginRows()).toHaveLength(1)
    expect(loginRows()[0]).toMatchObject({ operator: '小王', ip: '9.8.7.*', summary: { via: 'wecom' }, ok: true })
  })
})

describe('recordAudit 回报写没写成', () => {
  it('写成回 true；库写失败回 false、不抛——调用方据此决定要不要告警', async () => {
    expect(await recordAudit({ action: 'saveSettings', operator: 'admin', ok: true })).toBe(true)
    control.setBeforeAdd(({ coll }: { coll: string }) => {
      if (coll === COLLECTIONS.auditLog) throw new Error('DB_DOWN')
    })
    expect(await recordAudit({ action: 'saveSettings', operator: 'admin', ok: true })).toBe(false)
  })

  it('登录审计也走 recordAudit：落库行与操作审计同一形状（含 error 字段）', async () => {
    await post('login', SUPER)
    expect(loginRows()[0]).toHaveProperty('error', '')
  })
})
