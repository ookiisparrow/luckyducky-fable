// loadErrors：多路加载失败各自点名，不被成功的一路吞掉。
import { describe, it, expect } from 'vitest'
import { loadErrors } from '../src/lib/status'

describe('loadErrors', () => {
  it('大白话：全成功回空串', () => {
    expect(loadErrors([[{ ok: true }, '采购单'], [{ ok: true }, '供应商']])).toBe('')
  })
  it('大白话：只列失败的几路，按传入顺序用「；」连；业务码挂在「操作没成功」后的括号里，没码也给完整一句', () => {
    expect(loadErrors([[{ ok: false, error: 'A' }, '采购单'], [{ ok: true }, '物料主档'], [{ ok: false }, '供应商']])).toBe(
      '采购单加载失败：操作没成功（A）；供应商加载失败：操作没成功，请重试'
    )
  })
  it('大白话：传输层码说人话，不带码', () => {
    expect(loadErrors([[{ ok: false, error: 'NETWORK:Failed to fetch' }, '采购单']])).toBe('采购单加载失败：网络不通，请检查网络后重试。')
  })
})
