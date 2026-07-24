// 变异分诊批二（2026-07-24）：shared 小文件五连杀（status/checkout/observability/learning/limits·共 17 幸存）。
// 期望值全部取自各源码注释（PAY_WINDOW=15 分钟、价格「有限正数且≤上限」、指纹「安全字符+截断 120」、
// VOD FileId「纯数字 8-32 位」、搭配购表为定价单源），不发明行为。
import { describe, it, expect } from 'vitest'
import { statesOf, type StatusSpec } from '../src/status'
import { CHECKOUT_ADDONS, COUPON, SHIP } from '../src/checkout'
import { anomalyFingerprint } from '../src/observability'
import { isVodFileId } from '../src/learning'
import { MAX_PRICE_YUAN, PAY_WINDOW_MS, isValidPriceYuan } from '../src/limits'

describe('statesOf（状态机声明的运行时派生）', () => {
  it('大白话：initial/terminal/转移表里出现过的状态全收齐、去重、按字典序排——少收/不排都红', () => {
    const spec: StatusSpec = {
      collection: 'x',
      initial: ['zz'],
      terminal: ['aa'],
      transitions: [{ from: ['mm', 'zz'], to: 'bb', trigger: 't' }],
    }
    // zz 重复出现（initial+from）只留一份；aa/bb/mm/zz 必须字典序
    expect(statesOf(spec)).toEqual(['aa', 'bb', 'mm', 'zz'])
  })
})

describe('CHECKOUT_ADDONS（搭配购定价单源·云端 createOrder 派生权威定价）', () => {
  it('大白话：两件搭配购的 id/名称/元价逐字段钉死——定价单源被改必红', () => {
    expect(CHECKOUT_ADDONS).toEqual([
      { id: 'hook', name: '替换钩针组 · 2.5 / 3.0mm', price: 39 },
      { id: 'yarn', name: '补充棉线包 · 暖色 5 色', price: 29 },
    ])
    expect(COUPON).toBe(20)
    expect(SHIP).toBe(0)
  })
})

describe('anomalyFingerprint（异常去重键·确定性 _id）', () => {
  it('大白话：带 scope 用下划线接、不带不接；非法字符剥掉；超长截到 120（合法 doc _id）', () => {
    expect(anomalyFingerprint('flow-failure', 'PAY_CB', 'o1')).toBe('anom_flow-failure_PAY_CB_o1')
    expect(anomalyFingerprint('flow-failure', 'PAY_CB')).toBe('anom_flow-failure_PAY_CB')
    expect(anomalyFingerprint('client-error', '错误:x', 'o/2')).toBe('anom_client-error_x_o2')
    expect(anomalyFingerprint('server-exception', 'C'.repeat(300)).length).toBe(120)
  })
})

describe('isVodFileId（VOD FileId 判据单源·三处分流新旧线）', () => {
  it('大白话：纯数字 8-32 位才算 VOD；短了/长了/混字母/cloud:// 前缀/前后缀夹带都不算', () => {
    expect(isVodFileId('5285890784246869296')).toBe(true)
    expect(isVodFileId('12345678')).toBe(true) // 恰 8 位（下界）
    expect(isVodFileId('1'.repeat(32))).toBe(true) // 恰 32 位（上界）
    expect(isVodFileId('1234567')).toBe(false) // 7 位太短
    expect(isVodFileId('1'.repeat(33))).toBe(false) // 33 位太长
    expect(isVodFileId('cloud://env.abc/video.mp4')).toBe(false)
    expect(isVodFileId('a12345678')).toBe(false) // 前夹带（削 ^ 锚必红）
    expect(isVodFileId('12345678b')).toBe(false) // 后夹带（削 $ 锚必红）
  })
})

describe('limits（交易输入边界·上架与下单共用单源）', () => {
  it('大白话：支付窗口恰是 15 分钟的毫秒数——算式被动手脚必红', () => {
    expect(PAY_WINDOW_MS).toBe(900_000)
  })

  it('大白话：价格 0 不合法（>0 严格）、恰到上限合法（≤ 含等）、超上限/负串/Infinity/NaN 全拒', () => {
    expect(isValidPriceYuan(0)).toBe(false) // 0 元不可上架/下单（>= 变异必红）
    expect(isValidPriceYuan(MAX_PRICE_YUAN)).toBe(true) // 恰 10 万元合法（< 变异必红）
    expect(isValidPriceYuan(MAX_PRICE_YUAN + 1)).toBe(false) // 超上限拒（&& true 变异必红）
    expect(isValidPriceYuan('-5')).toBe(false) // truthy 非法串
    expect(isValidPriceYuan(Infinity)).toBe(false)
    expect(isValidPriceYuan('abc')).toBe(false)
    expect(isValidPriceYuan('99.9')).toBe(true) // 合法元价字符串收编（Number 化）
  })
})
