// LD-005：adminApi 顶层 handler 异常的审计记录必须带业务模块归因。
import { beforeEach, describe, expect, it } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi, registries } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (payload: Record<string, unknown>) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '7.7.7.7' },
    body: JSON.stringify(payload),
  }) as Promise<any>

describe('LD-005：adminApi 异常模块归因', () => {
  beforeEach(() => {
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
  })

  it('handler 抛错时，顶层失败审计带出 action 所属模块', async () => {
    const original = registries.ACTIONS.saveSettings
    registries.ACTIONS.saveSettings = async () => {
      throw new Error('LD005_TEST_FAILURE')
    }
    try {
      const response = await post({ action: 'saveSettings', key: 'super-secret-key' })
      expect(response.statusCode).toBe(500)
      const log = control.dump('auditLog').find((entry: any) => entry.action === 'saveSettings')
      expect(log).toMatchObject({ ok: false, error: 'SERVER_ERROR', module: 'shop' })
    } finally {
      registries.ACTIONS.saveSettings = original
    }
  })

  // 回包序列化在网关做：结果带 BigInt/环引用时 stringify 会抛，也得落回 500 + CORS 头 + 失败审计，不能冒成云函数裸异常
  it('handler 结果序列化不了时，同样回 500 并记失败审计', async () => {
    const original = registries.ACTIONS.saveSettings
    registries.ACTIONS.saveSettings = async () => ({ ok: true, n: BigInt(1) })
    try {
      const response = await post({ action: 'saveSettings', key: 'super-secret-key' })
      expect(response.statusCode).toBe(500)
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
      expect(JSON.parse(response.body)).toEqual({ ok: false, error: 'SERVER_ERROR' })
      const log = control.dump('auditLog').find((entry: any) => entry.action === 'saveSettings')
      expect(log).toMatchObject({ ok: false, error: 'SERVER_ERROR', module: 'shop' })
    } finally {
      registries.ACTIONS.saveSettings = original
    }
  })
})
