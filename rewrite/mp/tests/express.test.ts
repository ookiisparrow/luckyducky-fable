// 快递100 编码映射（lib/express.ts expressCode）：命中/模糊含/未命中三类（批次C 快递100 插件接通）。
import { describe, it, expect } from 'vitest'
import { expressCode } from '../lib/express'

describe('expressCode 快递公司名→快递100 编码', () => {
  it('精确命中：常见快递公司中文名映射到对应编码', () => {
    expect(expressCode('顺丰')).toBe('shunfeng')
    expect(expressCode('中通')).toBe('zhongtong')
    expect(expressCode('EMS')).toBe('ems')
  })

  it('模糊含：公司名带前后缀（如「顺丰速运」）仍按关键字命中', () => {
    expect(expressCode('顺丰速运')).toBe('shunfeng')
    expect(expressCode('京东物流')).toBe('jd')
    expect(expressCode('中国邮政')).toBe('youzhengguonei')
  })

  it('未命中：不在编码表内的公司名、空值均返回空串（调用方回退复制运单号）', () => {
    expect(expressCode('某某快运')).toBe('')
    expect(expressCode('')).toBe('')
    expect(expressCode(null)).toBe('')
    expect(expressCode(undefined)).toBe('')
  })
})
