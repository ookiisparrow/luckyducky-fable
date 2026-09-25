// loadErrors：多路加载失败各自点名，不被成功的一路吞掉。
import { describe, it, expect } from 'vitest'
import { loadErrors } from '../src/lib/status'

describe('loadErrors', () => {
  it('大白话：全成功回空串', () => {
    expect(loadErrors([[{ ok: true }, '采购单'], [{ ok: true }, '供应商']])).toBe('')
  })
  it('大白话：只列失败的几路，按传入顺序用「；」连，原因原文照带、缺原因留空', () => {
    expect(loadErrors([[{ ok: false, error: 'A' }, '采购单'], [{ ok: true }, '物料主档'], [{ ok: false }, '供应商']])).toBe('采购单加载失败：A；供应商加载失败：')
  })
})
