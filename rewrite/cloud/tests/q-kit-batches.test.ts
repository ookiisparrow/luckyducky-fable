// listBatches 翻页有上限（50 页×200）：触顶要明说「可能不全」，不能静默截断让批次计数看起来是全量。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const codes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ _id: 'Q' + String(i).padStart(6, '0'), courseId: 'c1', batchId: 'b-1', status: 'unused', createdAt: 1 }))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})

describe('listBatches 触顶标 truncated', () => {
  it('大白话：码数超过翻页上限→回包带 truncated:true（计数不是全量）', async () => {
    control.seed('qrcodes', codes(10_001))
    const r = await post('listBatches', { courseId: 'c1' })
    expect(r.ok).toBe(true)
    expect(r.truncated).toBe(true)
    expect(r.list[0].total).toBe(10_000)
  })

  it('大白话：码数正好 1 万（第 50 页刚好满、后面没了）→不误报 truncated', async () => {
    control.seed('qrcodes', codes(10_000))
    const r = await post('listBatches', { courseId: 'c1' })
    expect(r.truncated).toBe(false)
    expect(r.list[0].total).toBe(10_000)
  })

  it('大白话：没触顶→truncated:false', async () => {
    control.seed('qrcodes', codes(250))
    const r = await post('listBatches', { courseId: 'c1' })
    expect(r.truncated).toBe(false)
    expect(r.list[0].total).toBe(250)
  })
})
