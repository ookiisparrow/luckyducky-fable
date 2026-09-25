// 后台失败提示不甩裸码：传输层码说人话；读失败点名哪块没出来（多处同时挂才分得清），
// 写失败不冠「X失败」（写操作超时可能已生效）；没有中文映射的业务码挂括号保留，方便排查；没码也不留半句「加载失败：」。
import { describe, it, expect } from 'vitest'
import { failText, writeFailText } from '../src/lib/mapCs'
import { transportErrorText } from '../src/lib/mapSystem'

const TRANSPORT = ['CALL_TIMEOUT', 'NETWORK:Failed to fetch', 'SESSION_LOST']

describe('failText（读）', () => {
  it.each(TRANSPORT)('大白话：%s 点名哪块没加载出来，后接人话，不带码', (code) => {
    const t = failText('质检报表加载失败', code)
    expect(t).toBe('质检报表加载失败：' + transportErrorText(code))
    expect(t).not.toMatch(/[A-Z]{4,}/)
  })

  it('大白话：没映射的业务码挂括号保留', () => {
    expect(failText('加载失败', 'BAD_ARGS')).toBe('加载失败（BAD_ARGS）')
  })

  it('大白话：没码时给完整一句', () => {
    expect(failText('加载失败', undefined)).toBe('加载失败，请重试')
  })
})

describe('writeFailText（写）', () => {
  it.each(TRANSPORT)('大白话：%s 说人话，不带码、不说失败', (code) => {
    const t = writeFailText('保存失败', code)
    expect(t).toBe(transportErrorText(code))
    expect(t).not.toMatch(/失败|[A-Z]{4,}/)
  })

  it('大白话：业务码与没码时同读', () => {
    expect(writeFailText('保存失败', 'BAD_ARGS')).toBe('保存失败（BAD_ARGS）')
    expect(writeFailText('保存失败', '')).toBe('保存失败，请重试')
  })
})
