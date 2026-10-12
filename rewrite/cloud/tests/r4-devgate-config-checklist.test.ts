// 配置清单：环境变量里的密钥是「函数详情会明文回显」的泄露面（#400-12、#400-6 续），只看在不在、不读值。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key-r4'
const ENV_KEYS = ['WXPAY_MCH_PRIVATE_KEY', 'WXPAY_MCH_SERIAL', 'ADMIN_BOOTSTRAP_KEY']

const checklist = () =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action: 'getConfigChecklist', key: SUPER, data: {} }),
  }).then((r: any) => JSON.parse(r.body))

const item = (groups: any[], key: string) => groups.flatMap((g: any) => g.items).find((i: any) => i.key === key)

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  for (const k of ENV_KEYS) delete process.env[k]
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
})
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('商户私钥还在环境变量里 → 不算「已配」，提示迁到安全配置', () => {
  it('只在环境变量 → check + 迁移提示，值不回显', async () => {
    process.env.WXPAY_MCH_PRIVATE_KEY = 'SENTINEL_ENV_PRIVKEY_r4'
    const r = await checklist()
    const it = item(r.groups, 'WXPAY_MCH_PRIVATE_KEY')
    expect(it.status).toBe('check')
    expect(it.noteExtra).toContain('已配置，但应迁到安全配置')
    // 库里还没有时先删环境变量，对账就拿不到私钥：提示必须说先填再删
    expect(it.noteExtra).toContain('安全配置里还没有')
    expect(it.noteExtra).toContain('本页只查得到 adminApi')
    expect(JSON.stringify(r)).not.toContain('SENTINEL_ENV_PRIVKEY_r4')
  })

  it('库里已有、环境变量也还留着 → 仍是 check（留着的那份照样会被回显），提示可以删了', async () => {
    process.env.WXPAY_MCH_PRIVATE_KEY = 'SENTINEL_LEGACY_r4'
    control.seed('secureConfig', [{ _id: 'wxpay', mchPrivateKey: 'SENTINEL_DBKEY_r4', mchSerial: 'S' }])
    const r = await checklist()
    const it = item(r.groups, 'WXPAY_MCH_PRIVATE_KEY')
    expect(it.status).toBe('check')
    expect(it.noteExtra).toContain('安全配置里已有')
    expect(it.noteExtra).not.toContain('还没有')
    expect(it.noteExtra).toContain('本页只查得到 adminApi')
    expect(JSON.stringify(r)).not.toMatch(/SENTINEL_(LEGACY|DBKEY)_r4/)
  })

  it('只在库里 → ok', async () => {
    control.seed('secureConfig', [{ _id: 'wxpay', mchPrivateKey: 'db-key', mchSerial: 'S' }])
    expect(item((await checklist()).groups, 'WXPAY_MCH_PRIVATE_KEY').status).toBe('ok')
  })
})

describe('ADMIN_BOOTSTRAP_KEY 首登后还在 → 显示「应删除」', () => {
  it('仍在 → 出一行 check，名字写明应删除，值不回显', async () => {
    process.env.ADMIN_BOOTSTRAP_KEY = 'SENTINEL_BOOTSTRAP_r4'
    const r = await checklist()
    const it = item(r.groups, 'ADMIN_BOOTSTRAP_KEY')
    expect(it.status).toBe('check')
    expect(it.name).toContain('应删除')
    expect(JSON.stringify(r)).not.toContain('SENTINEL_BOOTSTRAP_r4')
  })

  it('已删 → 不出这一行', async () => {
    expect(item((await checklist()).groups, 'ADMIN_BOOTSTRAP_KEY')).toBeUndefined()
  })
})
