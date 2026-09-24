// 管理端网关查表不吃原型链（与 app 网关同式·根因#3·见 course-chain-hardening）。
// 普通对象字面量继承 Object.prototype：鉴权通过后 ACTIONS['constructor'/'toString'] 非空，
// 会被当成真 handler 调用。空原型注册表下这些名字一律 UNKNOWN_ACTION。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi, registries } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key'
const post = (action: string) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: SUPER, data: {} }),
  }) as Promise<{ statusCode: number; body: string }>

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
})

describe('admin 网关未知 action 鉴权后不吃原型链（根因#3）', () => {
  const PROTO_KEYS = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']

  it('大白话：登录之后拿 constructor/toString 这类对象天生自带的名字当后台动作，一律按未知动作拒，不当真业务去跑', async () => {
    expect(Object.getPrototypeOf(registries.ACTIONS)).toBe(null)
    expect(typeof registries.ACTIONS.getSettings).toBe('function')
    for (const action of PROTO_KEYS) {
      expect(registries.ACTIONS[action]).toBeUndefined()
      const r = await post(action)
      expect(r.statusCode).toBe(400)
      expect(JSON.parse(r.body)).toEqual({ ok: false, error: 'UNKNOWN_ACTION' })
    }
    const known = await post('getSettings')
    expect(known.statusCode).not.toBe(400)
    expect(JSON.parse(known.body).error).not.toBe('UNKNOWN_ACTION')
  })
})
