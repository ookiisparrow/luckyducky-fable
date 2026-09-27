// 坐席台轮询读次数（#400-31）：getThread 每 3 秒一次，每次先过网关鉴权。
// 鉴权该读的：频控档（本 IP + 全局）各一次、会话令牌一次；成功后清本 IP 失败计数要复用刚读到的频控档，不再读第二遍。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { COLLECTIONS } from '@ldrw/shared'

const IP = '30.0.0.7'
const post = (action: string, key: string, data: Record<string, unknown> = {}) =>
  adminApi({ httpMethod: 'POST', headers: { 'x-forwarded-for': IP }, body: JSON.stringify({ action, key, data }) }).then((r: any) => ({
    status: r.statusCode,
    ...JSON.parse(r.body),
  }))

// 按集合数每次读（doc().get() 与 where().get() 都经 beforeGet）
function countReads(): Record<string, number> {
  const n: Record<string, number> = {}
  control.setBeforeGet(async ({ coll }: any) => {
    n[coll] = (n[coll] || 0) + 1
  })
  return n
}

beforeEach(() => {
  control.reset()
  control.seed(COLLECTIONS.adminConfig, [
    { _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' },
    { _id: 'agent-1', keyHash: sha('outsourced-key-1'), role: 'outsourced', name: '外包一号' },
  ])
  control.seed(COLLECTIONS.csSession, [
    { _id: 'wxkf:kf1:eu1', status: 'active', agentId: 'agent-1', externalUserId: 'eu1', openKfId: 'kf1', openid: 'o1', createdAt: 1 },
  ])
})

describe('坐席台 getThread 每次请求的读次数', () => {
  it('大白话：一次轮询只读 5 次——频控档 2（本 IP + 全局）、会话令牌 1、会话 1、消息 1', async () => {
    const login = await post('login', 'outsourced-key-1')
    expect(login.ok).toBe(true)
    const reads = countReads()
    const r = await post('getThread', login.sessionToken, { sessionId: 'wxkf:kf1:eu1' })
    expect(r.ok).toBe(true)
    expect(reads).toEqual({ [COLLECTIONS.rateLimit]: 2, [COLLECTIONS.adminConfig]: 1, [COLLECTIONS.csSession]: 1, [COLLECTIONS.conversations]: 1 })
  })

  it('大白话：本 IP 有失败残留时成功请求照样清零，且不为此多读一次频控档', async () => {
    const login = await post('login', 'outsourced-key-1')
    await post('getThread', 'wrong-key-xyz', { sessionId: 'wxkf:kf1:eu1' })
    expect(control.dump(COLLECTIONS.rateLimit).find((d: any) => d._id === 'rl_adminlogin:' + IP).fails).toBe(1)
    const reads = countReads()
    expect((await post('getThread', login.sessionToken, { sessionId: 'wxkf:kf1:eu1' })).ok).toBe(true)
    expect(reads[COLLECTIONS.rateLimit]).toBe(2)
    expect(control.dump(COLLECTIONS.rateLimit).find((d: any) => d._id === 'rl_adminlogin:' + IP).fails).toBe(0)
  })
})
