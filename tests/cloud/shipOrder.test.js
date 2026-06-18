import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'
import { wxDeliveryCode } from '../../packages/cloud/src/kit/shipping'

// 发货合规债#26（根因#12 平台接缝）：shipOrder 本地翻 shipped 后向微信上传发货信息（cloud.openapi），
// fail-soft——上传失败绝不反噬本地发货 + 留痕 + [LD_ALERT] 告警。本套行为锁即守卫 shipping-upload-fail-soft 的 reverseTest。
const KEY = 'ship-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
async function call(action, data = {}) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key: KEY, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}
const seedOrder = (over = {}) =>
  control.seed('orders', [
    { _id: 'o1', _openid: 'buyer-1', status: 'paid', transactionId: 'wxpay-tx-1', amount: 19800, ...over },
  ])

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
})

describe('shipOrder 发货 → 微信上传发货信息（债#26·根因#12）', () => {
  it('上传成功：本地翻 shipped + 留痕 wxShipUploaded + 透传 transactionId/payer/编码', async () => {
    seedOrder()
    const r = await call('shipOrder', { id: 'o1', company: '顺丰', trackingNo: 'SF12345' })
    expect(r.ok).toBe(true)
    expect(r.wxShip).toBe(true)
    const o = control.dump('orders').find((d) => d._id === 'o1')
    expect(o.status).toBe('shipped')
    expect(o.wxShipUploaded).toBe(true)
    const payload = control.openapiCalls()[0]
    expect(payload.orderKey.transactionId).toBe('wxpay-tx-1')
    expect(payload.payer.openid).toBe('buyer-1')
    expect(payload.shippingList[0].expressCompany).toBe('SF') // 顺丰→微信编码
    expect(payload.shippingList[0].trackingNo).toBe('SF12345')
  })

  it('fail-soft：微信上传失败（能力未开通）本地仍 shipped + 留痕错误 + [LD_ALERT] 告警', async () => {
    seedOrder()
    control.setOpenapiFail(true, 268440002) // 模拟未开通发货能力的错误码
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call('shipOrder', { id: 'o1', company: '中通', trackingNo: 'ZT999' })
    expect(r.ok).toBe(true) // 发货本身成功（钱链不反噬）
    expect(r.wxShip).toBe(false)
    const o = control.dump('orders').find((d) => d._id === 'o1')
    expect(o.status).toBe('shipped') // 本地照样发货
    expect(o.wxShipUploaded).toBe(false)
    expect(o.wxShipError).toContain('WX_ERR_268440002')
    const alerted = spy.mock.calls.some((c) => String(c[0]).includes('[LD_ALERT]') && String(c[0]).includes('sev=money'))
    expect(alerted).toBe(true)
    spy.mockRestore()
  })

  it('缺 transactionId：不调微信、留痕 NO_TRANSACTION_ID、本地仍发货', async () => {
    seedOrder({ transactionId: '' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call('shipOrder', { id: 'o1', company: '圆通', trackingNo: 'YT1' })
    expect(r.ok).toBe(true)
    expect(r.wxShip).toBe(false)
    expect(control.openapiCalls().length).toBe(0) // 无支付单号→不打微信
    const o = control.dump('orders').find((d) => d._id === 'o1')
    expect(o.status).toBe('shipped')
    expect(o.wxShipError).toBe('NO_TRANSACTION_ID')
    spy.mockRestore()
  })

  it('改单号（shipped→shipped）二次发货同样触发上传', async () => {
    seedOrder({ status: 'shipped', shippedAt: 1 })
    const r = await call('shipOrder', { id: 'o1', company: '韵达', trackingNo: 'YD-NEW' })
    expect(r.ok).toBe(true)
    expect(control.openapiCalls().length).toBe(1)
  })
})

describe('wxDeliveryCode 物流公司编码映射（债#26）', () => {
  it('登记公司→微信编码；未登记→OTHER', () => {
    expect(wxDeliveryCode('顺丰')).toBe('SF')
    expect(wxDeliveryCode('顺丰速运')).toBe('SF')
    expect(wxDeliveryCode('邮政')).toBe('YZPY')
    expect(wxDeliveryCode('某不知名快递')).toBe('OTHER')
    expect(wxDeliveryCode('')).toBe('OTHER')
  })
})
