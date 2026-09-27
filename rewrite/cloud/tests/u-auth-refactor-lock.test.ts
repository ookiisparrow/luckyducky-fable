// adminApi 网关/配置清单的行为锁：身份推导、模块归因、审计形状、集合预建时机、清单逐字段接线。
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { control } from 'wx-server-sdk'
import { main as adminApi, registries } from '../src/functions/adminApi/index'
import { sha, checkKey } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

const post = (action: string, key: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const pick = (r: any) => ({ ok: r.ok, operator: r.operator, agentId: r.agentId, caps: r.caps })

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})

describe('身份推导：口令 / 会话令牌 / 企微免登三条路算出同一个身份', () => {
  const KEY = 'lock-key-123456'
  const cases: [string, Record<string, unknown>, { operator: string; agentId: string; caps: string[] }][] = [
    ['超管·有 role 有 name', { _id: 'auth', role: 'superadmin', name: '老板' }, { operator: '老板', agentId: 'admin', caps: ['*'] }],
    ['超管·无 role 有 caps', { _id: 'auth', caps: ['admin:write'] }, { operator: 'admin', agentId: 'admin', caps: ['admin:write'] }],
    ['超管·无 role 无 caps', { _id: 'auth' }, { operator: 'admin', agentId: 'admin', caps: ['*'] }],
    ['外包·有 role', { _id: 'ag1', role: 'outsourced' }, { operator: 'ag1', agentId: 'ag1', caps: ['agent:handle'] }],
    ['外包·无 role 有 caps 有 name', { _id: 'ag2', name: '二号', caps: ['customer:view'] }, { operator: '二号', agentId: 'ag2', caps: ['customer:view'] }],
    ['外包·无 role 无 caps', { _id: 'ag3' }, { operator: 'ag3', agentId: 'ag3', caps: [] }],
  ]
  for (const [label, acct, want] of cases) {
    it(`大白话：${label}`, async () => {
      const seed = [{ ...acct, keyHash: sha(KEY), wecomUserId: 'wu' }]
      if (acct._id !== 'auth') seed.push({ _id: 'auth', keyHash: sha('other-super-key'), role: 'superadmin', wecomUserId: 'x' } as any)
      control.seed('adminConfig', seed)
      const expected = { ok: true, ...want }
      expect(pick(await checkKey(getDb(), KEY, false))).toEqual(expected)
      const login = await post('login', KEY)
      expect(pick(login)).toEqual(expected)
      expect(pick(await checkKey(getDb(), login.sessionToken, false))).toEqual(expected)

      control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
      const saved = globalThis.fetch
      ;(globalThis as any).fetch = async (url: any) => ({
        json: async () => (String(url).includes('auth/getuserinfo') ? { errcode: 0, userid: 'wu' } : { errcode: 0 }),
      })
      try {
        const wecom = await post('loginByWecomCode', '', { code: 'c' })
        expect(pick(wecom)).toEqual(expected)
        expect(wecom.sessionToken).toHaveLength(64)
      } finally {
        globalThis.fetch = saved
      }
    })
  }

  it('大白话：首登引导返回形状不变', async () => {
    process.env.ADMIN_BOOTSTRAP_KEY = 'deploy-secret-lock'
    try {
      expect(await checkKey(getDb(), 'deploy-secret-lock', true)).toEqual({
        ok: true,
        bootstrapped: true,
        caps: ['*'],
        operator: 'admin',
        agentId: 'admin',
      })
    } finally {
      delete process.env.ADMIN_BOOTSTRAP_KEY
    }
  })
})

describe('adminConfig 集合只在首登写入前预建', () => {
  it('大白话：集合真没建（读报集合不存在）——首登引导照样建出超管档', async () => {
    control.markUncreated('adminConfig')
    control.setBeforeGet((a: any) => {
      if (a.coll === 'adminConfig' && !control.dump('adminConfig').length) throw new Error('DATABASE_COLLECTION_NOT_EXIST:adminConfig')
    })
    process.env.ADMIN_BOOTSTRAP_KEY = 'deploy-secret-lock'
    try {
      expect(await post('login', 'deploy-secret-lock')).toMatchObject({ status: 200, bootstrapped: true })
      expect(control.dump('adminConfig').map((d: any) => d._id)).toEqual(['auth'])
    } finally {
      delete process.env.ADMIN_BOOTSTRAP_KEY
      control.setBeforeGet(null as never)
    }
  })

  it('大白话：已有账号的普通请求不再每次顺手建 adminConfig', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    const db = getDb()
    const created: string[] = []
    const orig = db.createCollection.bind(db)
    db.createCollection = async (name: string) => {
      created.push(name)
      return orig(name)
    }
    try {
      expect((await post('getSettings', 'super-secret-key')).ok).toBe(true)
      expect(created).not.toContain('adminConfig')
    } finally {
      db.createCollection = orig
    }
  })
})

describe('模块归因：每个 action 都按 modules.json 的 adminActionFiles 归到模块', () => {
  it('大白话：挂载的 action 全部有模块，且与正册逐条一致', async () => {
    const reg = JSON.parse(readFileSync(resolve(__dirname, '../../../modules.json'), 'utf8'))
    const want: Record<string, string> = {}
    for (const [mod, spec] of Object.entries<any>(reg.modules)) {
      for (const file of spec.adminActionFiles || []) {
        const exports = await import(`../src/functions/adminApi/actions/${file}.ts`)
        for (const [name, fn] of Object.entries(exports)) if (registries.ACTIONS[name] === fn) want[name] = mod
      }
    }
    expect(Object.keys(want).sort()).toEqual(Object.keys(registries.ACTIONS).sort())
    expect({ ...registries.ADMIN_ACTION_MODULE_BY_NAME }).toEqual(want)
  })

  it('大白话：建号/停用坐席写口令哈希、清会话，是身份凭证逻辑，归 identity，不归客服', () => {
    for (const a of ['createAgent', 'setAgentWecomUserId', 'disableAgent', 'listAgents'])
      expect(registries.ADMIN_ACTION_MODULE_BY_NAME[a], a).toBe('identity')
  })
})

describe('操作审计：成功不带模块、异常带模块，两路字段一致', () => {
  it('大白话：保存设置成功记一条 ok 且无 module；handler 抛错记一条失败带 module', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    expect((await post('saveSettings', 'super-secret-key', { urlPrefix: 'https://a.example/' })).ok).toBe(true)
    const okLog = control.dump('auditLog').find((e: any) => e.action === 'saveSettings')
    expect(okLog).toMatchObject({ ok: true, error: '', operator: 'admin', ip: '9.9.9.9' })
    expect('module' in okLog).toBe(false)

    const original = registries.ACTIONS.saveSettings
    registries.ACTIONS.saveSettings = async () => {
      throw new Error('LOCK_FAIL')
    }
    try {
      expect(await post('saveSettings', 'super-secret-key', { urlPrefix: 'x' })).toMatchObject({ status: 500, error: 'SERVER_ERROR' })
    } finally {
      registries.ACTIONS.saveSettings = original
    }
    const logs = control.dump('auditLog').filter((e: any) => e.action === 'saveSettings')
    expect(logs).toHaveLength(2)
    expect(logs[1]).toMatchObject({ ok: false, error: 'SERVER_ERROR', module: 'shop', operator: 'admin', ip: '9.9.9.9' })
  })
})

describe('配置清单：每个可填项的位置、状态、填写目标都指向同一个字段', () => {
  const FILLABLE: [string, string, string][] = [
    ['secureConfig', 'wxkf', 'corpId'],
    ['secureConfig', 'wxkf', 'secret'],
    ['secureConfig', 'wxkf', 'token'],
    ['secureConfig', 'wxkf', 'aesKey'],
    ['secureConfig', 'wxkf', 'agentId'],
    ['secureConfig', 'wxkf', 'miniappAppId'],
    ['secureConfig', 'wxkf', 'thumbMediaId'],
    ['secureConfig', 'wxpay', 'mchPrivateKey'],
    ['secureConfig', 'wxpay', 'mchSerial'],
    ['secureConfig', 'vod', 'secretId'],
    ['secureConfig', 'vod', 'secretKey'],
    ['secureConfig', 'vod', 'playKey'],
    ['secureConfig', 'vod', 'procedure'],
    ['config', 'pay', 'mode'],
    ['config', 'pay', 'subMchId'],
    ['config', 'pay', 'flowId'],
    ['config', 'pay', 'refundFlowId'],
  ]
  const fillables = (groups: any[]) => groups.flatMap((g: any) => g.items).filter((i: any) => i.fill)

  it('大白话：17 个可填项一一对应；只配一个字段时只有它变 ok', async () => {
    delete process.env.WXPAY_MCH_PRIVATE_KEY
    delete process.env.WXPAY_MCH_SERIAL
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    const base = fillables((await post('getConfigChecklist', 'super-secret-key')).groups)
    expect(base).toHaveLength(FILLABLE.length)
    for (const [coll, docId, field] of FILLABLE) {
      const item = base.find((i: any) => i.location === `DB ${coll}/${docId}.${field}`)
      expect(item, field).toBeTruthy()
      expect(item.fill).toMatchObject(
        coll === 'config'
          ? { action: 'savePayConfig', field }
          : { action: 'saveSecureConfig', docId, field }
      )
      if (coll === 'config') expect(item.fill.docId).toBeUndefined()

      control.reset()
      control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
      control.seed(coll, [{ _id: docId, [field]: 'v' }])
      const oks = fillables((await post('getConfigChecklist', 'super-secret-key')).groups).filter((i: any) => i.status === 'ok')
      expect(oks.map((i: any) => i.key), field).toEqual([item.key])
    }
  })
})
