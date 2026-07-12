// 人工配置清单可填写化守卫（决策 2026-07-12：saveSecureConfig/savePayConfig）。
//
// 三类守卫：
// ① RBAC 默认拒——未登记 ACTION_CAPS，外包账号一律 403。
// ② 校验/合并保存行为——bad docId/field 长度上限/aesKey 定长/mode 枚举/留空不改动既有值/合并不清空未提交字段。
// ③ 审计日志零泄露（铁律延伸）——saveSecureConfig 的 payload 嵌套在 `fields` 下，adminApi 通用审计
//    summarize() 顶层遍历只会把 `fields` 折叠成 '{…}'、不递归取值；断言 auditLog 里最新一条 summary
//    不含任何塞入的哨兵密钥值。
//
// 反向自检：把 secureConfig.ts 里 `data: { docId, fields }` 拍平成 `data: { docId, ...fields }`（顶层展开）
// → ③ 用例立即红（summarize 会把每个顶层字段值截断存进 summary）；改回嵌套即绿。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key-sc'
const A1 = 'outsourced-key-sc'

const post = (action: string, key: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '2.2.2.2' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-sc', keyHash: sha(A1), role: 'outsourced', name: '外包SC' },
  ])
})

describe('RBAC 默认拒：外包访问两个写 action 403（未登记 ACTION_CAPS→仅超管）', () => {
  it('大白话：外包 key 调 saveSecureConfig/savePayConfig 一律 403', async () => {
    expect((await post('saveSecureConfig', A1, { docId: 'wxkf', fields: { corpId: 'x' } })).status).toBe(403)
    expect((await post('savePayConfig', A1, { mode: 'real' })).status).toBe(403)
  })
})

describe('saveSecureConfig 校验', () => {
  it('大白话：docId 不是 wxkf/wxpay → 400 BAD_DOC', async () => {
    const r = await post('saveSecureConfig', SUPER, { docId: 'bogus', fields: { corpId: 'x' } })
    expect(r.status).toBe(400)
    expect(r.error).toBe('BAD_DOC')
  })

  it('大白话：fields 全空/全 undefined → 400 NO_FIELDS', async () => {
    const r1 = await post('saveSecureConfig', SUPER, { docId: 'wxkf', fields: {} })
    expect(r1.status).toBe(400)
    expect(r1.error).toBe('NO_FIELDS')
    const r2 = await post('saveSecureConfig', SUPER, { docId: 'wxkf', fields: { corpId: '' } })
    expect(r2.status).toBe(400)
    expect(r2.error).toBe('NO_FIELDS')
  })

  it('大白话：aesKey 长度不是 43 → 400 BAD_AESKEY_LEN', async () => {
    const r = await post('saveSecureConfig', SUPER, { docId: 'wxkf', fields: { aesKey: 'too-short' } })
    expect(r.status).toBe(400)
    expect(r.error).toBe('BAD_AESKEY_LEN')
  })

  it('大白话：字段值超长 → 400 TOO_LONG:<field>', async () => {
    const r = await post('saveSecureConfig', SUPER, { docId: 'wxkf', fields: { corpId: 'x'.repeat(65) } })
    expect(r.status).toBe(400)
    expect(r.error).toBe('TOO_LONG:corpId')
  })

  it('大白话：非白名单字段（docId 不匹配的字段）被忽略而非写入——wxpay 传 corpId 无效字段应 400 NO_FIELDS', async () => {
    const r = await post('saveSecureConfig', SUPER, { docId: 'wxpay', fields: { corpId: 'not-a-wxpay-field' } })
    expect(r.status).toBe(400)
    expect(r.error).toBe('NO_FIELDS')
  })
})

describe('saveSecureConfig 合并保存行为', () => {
  it('大白话：先存 corpId 再存 secret——两次都只传一个字段，最终 doc 两个字段都在（合并不清空）', async () => {
    expect((await post('saveSecureConfig', SUPER, { docId: 'wxkf', fields: { corpId: 'ww-corp-1' } })).ok).toBe(true)
    expect((await post('saveSecureConfig', SUPER, { docId: 'wxkf', fields: { secret: 'sec-1' } })).ok).toBe(true)
    const doc = control.dump('secureConfig').find((d: any) => d._id === 'wxkf')
    expect(doc.corpId).toBe('ww-corp-1')
    expect(doc.secret).toBe('sec-1')
  })

  it('大白话：留空提交（字段值为空串）不改动既有值', async () => {
    await post('saveSecureConfig', SUPER, { docId: 'wxkf', fields: { corpId: 'keep-me' } })
    // 第二次提交 corpId 空串 + secret 有值：corpId 应保持原值不被清空，secret 正常写入
    await post('saveSecureConfig', SUPER, { docId: 'wxkf', fields: { corpId: '', secret: 'new-secret' } })
    const doc = control.dump('secureConfig').find((d: any) => d._id === 'wxkf')
    expect(doc.corpId).toBe('keep-me')
    expect(doc.secret).toBe('new-secret')
  })

  it('大白话：mchPrivateKey 保存前经 normalizePem 规整（塌行的 \\n 字面量重建成规范 PEM）', async () => {
    const raw = '-----BEGIN PRIVATE KEY-----\\nMIIBVQIBADANBgkqhkiG\\n-----END PRIVATE KEY-----'
    const r = await post('saveSecureConfig', SUPER, { docId: 'wxpay', fields: { mchPrivateKey: raw } })
    expect(r.ok).toBe(true)
    const doc = control.dump('secureConfig').find((d: any) => d._id === 'wxpay')
    expect(doc.mchPrivateKey).toContain('-----BEGIN PRIVATE KEY-----\n')
    expect(doc.mchPrivateKey).toContain('-----END PRIVATE KEY-----\n')
  })
})

describe('savePayConfig 校验与合并保存', () => {
  it('大白话：mode 不是 real/mock → 400 BAD_MODE', async () => {
    const r = await post('savePayConfig', SUPER, { mode: 'bogus' })
    expect(r.status).toBe(400)
    expect(r.error).toBe('BAD_MODE')
  })

  it('大白话：字段超长 → 400 TOO_LONG:<field>', async () => {
    const r = await post('savePayConfig', SUPER, { flowId: 'x'.repeat(101) })
    expect(r.status).toBe(400)
    expect(r.error).toBe('TOO_LONG:flowId')
  })

  it('大白话：分两次分别存 mode 与 subMchId——合并不清空', async () => {
    expect((await post('savePayConfig', SUPER, { mode: 'real' })).ok).toBe(true)
    expect((await post('savePayConfig', SUPER, { subMchId: '1113881793' })).ok).toBe(true)
    const doc = control.dump('config').find((d: any) => d._id === 'pay')
    expect(doc.mode).toBe('real')
    expect(doc.subMchId).toBe('1113881793')
  })
})

describe('审计日志零泄露（铁律延伸）：saveSecureConfig 的密钥值绝不出现在 auditLog', () => {
  it('大白话：塞哨兵密钥值保存后，auditLog 最新一条 summary 里不含该哨兵串', async () => {
    await post('saveSecureConfig', SUPER, {
      docId: 'wxkf',
      fields: { corpId: 'ww1', secret: 'SENTINEL_AUDIT_LEAK_CHECK_7c2', aesKey: 'x'.repeat(43) },
    })
    const logs = control.dump('auditLog')
    const last = logs[logs.length - 1]
    expect(last).toBeTruthy()
    expect(last.action).toBe('saveSecureConfig')
    expect(JSON.stringify(last)).not.toContain('SENTINEL_AUDIT_LEAK_CHECK_7c2')
  })
})
