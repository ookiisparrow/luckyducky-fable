// 黄金 kit-security（确定性主键幂等·设计约束#1）（守卫 rw-kit-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { ensureDoc } from '../src/kit'

beforeEach(() => control.reset())

describe('ensureDoc（确定性 _id 幂等建档）', () => {
  it('大白话：以业务键作主键建档并读回真档', async () => {
    const doc = await ensureDoc('users', 'oME', { nickname: '鸭' })
    expect(doc._id).toBe('oME')
    expect(doc.nickname).toBe('鸭')
    expect(control.dump('users').length).toBe(1)
  })

  it('大白话：撞键=并发方已写——吞掉、读回已有档，绝不产生第二条、不覆盖已有值', async () => {
    control.seed('users', [{ _id: 'oME', nickname: '老档' }])
    const doc = await ensureDoc('users', 'oME', { nickname: '新档' })
    expect(doc.nickname).toBe('老档')
    expect(control.dump('users').length).toBe(1)
  })

  it('大白话：并发首写同一键只产生一条档', async () => {
    await Promise.all(Array.from({ length: 5 }, () => ensureDoc('progress', 'oME:c1', { seen: 1 })))
    expect(control.dump('progress').length).toBe(1)
  })
})
