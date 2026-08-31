import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { setBrandFetchForTest } from '../src/kit/wxbrand'
import type { WxFetch } from '../src/kit/wxpay'

const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

function seedReady() {
  control.seed('couponConfig', [
    { _id: 'offer', enabled: true, label: '开业领券', brandId: '120344', productCouponId: 'pc1', stockId: 'st1', appid: 'wxcbd2fb68b81bcfb1' },
  ])
  control.seed('secureConfig', [
    {
      _id: 'wxbrand',
      brandPrivateKey: pair.privateKey,
      brandSerial: 'SER',
      wxpayPublicKey: pair.publicKey,
      wxpayPublicKeyId: 'PUB_KEY_ID_X',
      brandApiKey: 'k'.repeat(32),
    },
  ])
}

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  setBrandFetchForTest(async () => ({ status: 200, text: async () => JSON.stringify({ coupon_code: 'Code_1' }) }))
})
afterEach(() => setBrandFetchForTest())

describe('getCouponOffer', () => {
  it('大白话：没配或关掉 → enabled false，开着才回文案', async () => {
    expect((await call('getCouponOffer')).enabled).toBe(false)
    seedReady()
    const on = await call('getCouponOffer')
    expect(on).toEqual({ ok: true, enabled: true, label: '开业领券' })
    control.reset()
    control.seed('couponConfig', [{ _id: 'offer', enabled: false, label: '开业领券', brandId: '120344' }])
    expect((await call('getCouponOffer')).enabled).toBe(false)
  })
})

describe('claimCoupon', () => {
  it('大白话：没登录拒；关掉拒；缺批次拒', async () => {
    control.setOpenId('')
    expect((await call('claimCoupon')).error).toBe('NO_OPENID')
    control.setOpenId('oME')
    expect((await call('claimCoupon')).error).toBe('COUPON_DISABLED')
    control.seed('couponConfig', [{ _id: 'offer', enabled: true, brandId: '120344' }])
    expect((await call('claimCoupon')).error).toBe('COUPON_NOT_CONFIGURED')
  })

  it('大白话：开着则用云端 openid 发券，不信前端传来的 openid', async () => {
    seedReady()
    const seen: string[] = []
    const impl: WxFetch = async (url) => {
      seen.push(url)
      return { status: 200, text: async () => JSON.stringify({ coupon_code: 'Code_1' }) }
    }
    setBrandFetchForTest(impl)
    const r = await call('claimCoupon', { openid: 'FAKE' })
    expect(r.ok).toBe(true)
    expect(r.couponCode).toBe('Code_1')
    expect(seen[0]).toContain('/users/oME/coupons')
    expect(seen[0]).not.toContain('FAKE')
  })

  it('大白话：同一人同一批次再领拒；微信失败可观测且不静默当成功', async () => {
    seedReady()
    expect((await call('claimCoupon')).ok).toBe(true)
    expect((await call('claimCoupon')).error).toBe('COUPON_ALREADY_CLAIMED')
    control.reset()
    control.setOpenId('oME')
    seedReady()
    setBrandFetchForTest(async () => ({ status: 400, text: async () => '{"code":"LIMIT"}' }))
    const fail = await call('claimCoupon')
    expect(fail.error).toBe('COUPON_SEND_FAIL')
  })
})
