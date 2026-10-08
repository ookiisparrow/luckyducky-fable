// 黄金 kit-security（确定性主键幂等·设计约束#1）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { ensureDoc } from '../src/kit'

beforeEach(() => control.reset())

describe('ensureDoc（确定性 _id 幂等建档）', () => {
  // 正常建档读回、撞键读回已有档两种情形见 mutation-kill-ids.test.ts（断言同样严格）。
  it('大白话：并发首写同一键只产生一条档', async () => {
    await Promise.all(Array.from({ length: 5 }, () => ensureDoc('progress', 'oME:c1', { seen: 1 })))
    expect(control.dump('progress').length).toBe(1)
  })
})
