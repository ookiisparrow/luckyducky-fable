// 变异测试幸存者击杀：kit/shipping（发货信息上传接缝·债#26·根因#12 单点）。
// StrykerJS 该文件 71 个变异体幸存/无覆盖（变异分 7.8%）——本文件把「桩可测」的 A 类全部钉死：
//   ① 物流公司编码表逐条对（表被清空/值被改必红）；② wxDeliveryCode 修剪/兜底 OTHER 语义；
//   ③ uploadShippingToWx 缺 transactionId 前置拒绝（且不打微信）；④ 成功路径上传参数完整形状
//      （orderKey/shippingList/payer/itemDesc——参数残缺=微信侧发货登记失真）；⑤ errCode/errcode
//      非 0 判失败留原始码；⑥ 抛错路径（带码/裸 message/无 message）全部收敛 { ok:false }，绝不上抛。
// 期望值全部来自 shipping.ts 内注释与 WX_DELIVERY 表本身，不发明行为。
import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { wxDeliveryCode, uploadShippingToWx } from '../src/kit/shipping'

beforeEach(() => control.reset())

// 一笔真实形状的上传入参（金额不经此接缝·发货只有单号/公司/身份）
const SHIP = {
  orderId: 'o-20260724-001',
  openid: 'oUser-1',
  transactionId: 'tx-4200001234',
  company: '顺丰',
  trackingNo: 'SF001',
}

describe('wxDeliveryCode（物流公司中文名 → 微信编码表）', () => {
  it('大白话：登记过的公司名逐条都翻成对的微信编码（表被清空或任一编码被改必红）', () => {
    // 全表 19 行逐条对（与 shipping.ts WX_DELIVERY 一致·别名与全名同码）
    expect(wxDeliveryCode('顺丰')).toBe('SF')
    expect(wxDeliveryCode('顺丰速运')).toBe('SF')
    expect(wxDeliveryCode('圆通')).toBe('YTO')
    expect(wxDeliveryCode('圆通速递')).toBe('YTO')
    expect(wxDeliveryCode('中通')).toBe('ZTO')
    expect(wxDeliveryCode('中通快递')).toBe('ZTO')
    expect(wxDeliveryCode('申通')).toBe('STO')
    expect(wxDeliveryCode('申通快递')).toBe('STO')
    expect(wxDeliveryCode('韵达')).toBe('YD')
    expect(wxDeliveryCode('韵达速递')).toBe('YD')
    expect(wxDeliveryCode('邮政')).toBe('YZPY')
    expect(wxDeliveryCode('中国邮政')).toBe('YZPY')
    expect(wxDeliveryCode('EMS')).toBe('EMS')
    expect(wxDeliveryCode('京东')).toBe('JD')
    expect(wxDeliveryCode('京东物流')).toBe('JD')
    expect(wxDeliveryCode('极兔')).toBe('JTSD')
    expect(wxDeliveryCode('极兔速递')).toBe('JTSD')
    expect(wxDeliveryCode('德邦')).toBe('DBL')
    expect(wxDeliveryCode('德邦快递')).toBe('DBL')
  })

  it('大白话：没登记的/空的回 OTHER（微信允许其他公司），admin 录入带空格也要修剪后命中', () => {
    expect(wxDeliveryCode('不知名快递')).toBe('OTHER') // 未登记 → OTHER 兜底
    expect(wxDeliveryCode('')).toBe('OTHER') // 空串 → OTHER
    expect(wxDeliveryCode(' 顺丰 ')).toBe('SF') // trim 后命中（去掉 trim 必红）
    expect(wxDeliveryCode('顺丰 速运')).toBe('OTHER') // 中间空格不是修剪范围·未命中即 OTHER
  })
})

describe('uploadShippingToWx（发货上传云调用·fail-soft 单点）', () => {
  it('大白话：缺 transactionId 直接拒（NO_TRANSACTION_ID），一次都不打微信', async () => {
    const r = await uploadShippingToWx({ ...SHIP, transactionId: '' })
    expect(r).toEqual({ ok: false, error: 'NO_TRANSACTION_ID' })
    expect(control.openapiCalls().length).toBe(0) // 前置守门·不出站
  })

  it('大白话：成功路径回 { ok:true }，且上传给微信的参数形状完整不缺件', async () => {
    const r = await uploadShippingToWx(SHIP)
    expect(r).toEqual({ ok: true }) // 成功=纯 ok:true·无 error 字段
    const calls = control.openapiCalls()
    expect(calls.length).toBe(1)
    const p = calls[0]
    // orderKey：订单号类型 1（微信支付单号·无需 mchid）+ 真实 transactionId
    expect(p.orderKey).toEqual({ orderNumberType: 1, transactionId: 'tx-4200001234' })
    expect(p.logisticsType).toBe(1) // 1=实体物流
    expect(p.deliveryMode).toBe(1) // 1=统一发货（单包裹）
    // shippingList：恰好一件包裹·单号/公司编码/品名齐全（缺任一=微信侧发货登记失真）
    expect(p.shippingList).toEqual([{ trackingNo: 'SF001', expressCompany: 'SF', itemDesc: '钩织材料包' }])
    expect(p.payer).toEqual({ openid: 'oUser-1' }) // 买家身份
    expect(typeof p.uploadTime).toBe('string') // 上传时间随钟走·只锁形状
  })

  it('大白话：微信回 errCode≠0 判失败，错误串保留原始码供对账（WX_ERR_码）', async () => {
    control.setOpenapiResult({ errCode: 9700001 })
    const r = await uploadShippingToWx(SHIP)
    expect(r).toEqual({ ok: false, error: 'WX_ERR_9700001' })
  })

  it('大白话：小写 errcode 一样认（云调用两种壳都见过），非 0 同样判失败', async () => {
    control.setOpenapiResult({ errcode: 42 })
    const r = await uploadShippingToWx(SHIP)
    expect(r).toEqual({ ok: false, error: 'WX_ERR_42' })
  })

  it('大白话：回包里压根没有错误码字段（{}）→ 云调用正常返回即按成功算', async () => {
    control.setOpenapiResult({})
    const r = await uploadShippingToWx(SHIP)
    expect(r).toEqual({ ok: true })
  })

  it('大白话：云调用抛错带 errCode（能力未开通/权限未声明）→ 收成 WX_ERR_码，绝不上抛', async () => {
    control.setOpenapiFail(true, 48001) // 48001=api 功能未授权（真机常见首错）
    const r = await uploadShippingToWx(SHIP)
    expect(r).toEqual({ ok: false, error: 'WX_ERR_48001' })
  })

  it('大白话：抛的是普通错误（无 errCode）→ 回 message；连 message 都没有 → WX_SHIP_FAIL 兜底；总之不抛', async () => {
    // 桩的 setOpenapiFail 必带 errCode，盖不到「裸错误」分支——临时换掉 openapi 节点（同一 CJS 模块实例，
    // 源码与测试共享），用完还原，不动桩本体。
    const cloudAny = cloud as any
    const realOpenapi = cloudAny.openapi
    try {
      cloudAny.openapi = {
        wxaSecOrder: {
          uploadShippingInfo: async () => {
            throw new Error('boom')
          },
        },
      }
      expect(await uploadShippingToWx(SHIP)).toEqual({ ok: false, error: 'boom' }) // 取 message 原文·不是 String(e) 的 'Error: boom'
      cloudAny.openapi = {
        wxaSecOrder: {
          uploadShippingInfo: async () => {
            throw new Error('') // message 为空串（falsy）→ 走 WX_SHIP_FAIL 兜底
          },
        },
      }
      expect(await uploadShippingToWx(SHIP)).toEqual({ ok: false, error: 'WX_SHIP_FAIL' })
    } finally {
      cloudAny.openapi = realOpenapi
    }
  })
})
