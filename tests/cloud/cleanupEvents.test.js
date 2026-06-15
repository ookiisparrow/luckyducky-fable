import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/system/cleanupEvents'

// 债#9：events 流水定时清理——只删 90 天以上、保新；仅服务端触发（无 openid）。
const DAY = 24 * 3600 * 1000
beforeEach(() => {
  control.reset()
  control.setOpenId('') // 定时器/服务端触发：无 openid（isServerCall=true）
  control.seed('events', [
    { _id: 'fresh', _openid: 'u1', type: 'view', createdAt: Date.now() - 10 * DAY },
    { _id: 'edge', _openid: 'u1', type: 'view', createdAt: Date.now() - 89 * DAY },
    { _id: 'old', _openid: 'u1', type: 'view', createdAt: Date.now() - 91 * DAY },
    { _id: 'ancient', _openid: 'u1', type: 'view', createdAt: Date.now() - 200 * DAY },
  ])
})

describe('cleanupEvents 定时清理 events 流水（债#9）', () => {
  it('只删 90 天以上，保留新档（含 89 天边界）；返回删除数', async () => {
    const res = await main()
    expect(res).toMatchObject({ ok: true, removed: 2 }) // old + ancient
    const ids = control.dump('events').map((e) => e._id)
    expect(ids).toContain('fresh')
    expect(ids).toContain('edge') // 89 天 < 90 天保留，边界即验
    expect(ids).not.toContain('old')
    expect(ids).not.toContain('ancient')
  })

  it('客户端带身份调用一律拒、不删任何档（根因#3 写库必过闸）', async () => {
    control.setOpenId('user-X') // 客户端 callFunction 必带 openid
    expect((await main()).removed).toBe(0)
    expect(control.dump('events')).toHaveLength(4) // 一条未删
  })

  it('无过期档：removed=0 不抛', async () => {
    await main() // 第一遍删旧
    expect((await main()).removed).toBe(0)
  })
})
