// kit/secureConfig 读取契约守卫（配置清单审查批·2026-07-12）：迁移核心语义「DB 优先·env 兜底·都空 ''·
// **DB 空串不遮蔽 env**（typeof v==='string'&&v 分支）」直接钉在原语上——此前只有消费者 e2e 间接覆盖
// env 兜底/都空两态（app-cs1/app-cs2），DB 优先态与 getSecureConfigFields（本批起 6 处消费：kfCallback
// 外壳/onEvent、kfSendText、kfFetchMedia（2026-07-23 拓扑收编批：原 cs/kfSend、cs/kfMedia 独立函数
// 收编进 kit/wecom.ts 高层助手）、kfHealthProbe、cs.kfBind、wxbill）无直接测试。四态各一例，双函数同覆盖。
//
// 反向自检：把 getSecureConfig 的 `if (typeof v === 'string' && v) return v` 改成 `if (typeof v === 'string')
// return v`（空串遮蔽 env）→「DB 空串不遮蔽 env」用例立即红；改回即绿。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { getDb } from '../src/kit'
import { getSecureConfig, getSecureConfigFields } from '../src/kit/secureConfig'

const ENV_KEYS = ['WXKF_CORPID', 'WXKF_SECRET', 'WXKF_TOKEN']
const db = getDb()

beforeEach(() => {
  control.reset()
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('getSecureConfig 四态契约（DB 优先·env 兜底·都空·空串不遮蔽）', () => {
  it('大白话：DB 有值时用 DB，env 同名值被忽略（填写即生效·不被旧环境变量遮蔽）', async () => {
    process.env.WXKF_CORPID = 'env-corp-stale'
    control.seed('secureConfig', [{ _id: 'wxkf', corpId: 'db-corp-fresh' }])
    expect(await getSecureConfig(db, 'wxkf', 'corpId')).toBe('db-corp-fresh')
  })

  it('大白话：DB 无档/无字段时回退同名环境变量（迁移期兼容）', async () => {
    process.env.WXKF_CORPID = 'env-corp-legacy'
    expect(await getSecureConfig(db, 'wxkf', 'corpId')).toBe('env-corp-legacy')
  })

  it('大白话：DB 与 env 都没有 → 空串（fail-closed 由调用方守）', async () => {
    expect(await getSecureConfig(db, 'wxkf', 'corpId')).toBe('')
  })

  it('大白话：DB 存了空串不遮蔽 env（空=未配，继续兜底，不算「已配为空」）', async () => {
    process.env.WXKF_SECRET = 'env-secret-legacy'
    control.seed('secureConfig', [{ _id: 'wxkf', secret: '' }])
    expect(await getSecureConfig(db, 'wxkf', 'secret')).toBe('env-secret-legacy')
  })
})

describe('getSecureConfigFields 合并读同契约（一次 DB 往返·逐字段语义与单读一致）', () => {
  it('大白话：混合态一次取齐——DB 有的用 DB、缺的回退 env、都没有的空串', async () => {
    process.env.WXKF_SECRET = 'env-secret'
    control.seed('secureConfig', [{ _id: 'wxkf', corpId: 'db-corp', token: '' }])
    process.env.WXKF_TOKEN = 'env-token'
    const f = await getSecureConfigFields(db, 'wxkf', ['corpId', 'secret', 'token', 'aesKey'])
    expect(f.corpId).toBe('db-corp') // DB 优先
    expect(f.secret).toBe('env-secret') // DB 缺字段 → env
    expect(f.token).toBe('env-token') // DB 空串不遮蔽 env
    expect(f.aesKey).toBe('') // 都没有 → ''
  })
})
