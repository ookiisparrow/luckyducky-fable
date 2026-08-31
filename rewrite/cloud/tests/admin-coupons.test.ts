import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { setBrandFetchForTest } from '../src/kit/wxbrand'

const SUPER = 'super-secret-key-cp'
const A1 = 'outsourced-key-cp'
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const post = (action: string, key: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '3.3.3.3' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-cp', keyHash: sha(A1), role: 'outsourced', name: '外包券' },
  ])
})
afterEach(() => setBrandFetchForTest())

describe('admin 商品券开关', () => {
  it('大白话：外包碰开关 403；超管可关可开、手填批次', async () => {
    expect((await post('saveCouponConfig', A1, { offer: { enabled: true } })).status).toBe(403)
    const saved = await post('saveCouponConfig', SUPER, {
      offer: { enabled: true, label: '开业', brandId: '120344', productCouponId: 'pc1', stockId: 'st1' },
    })
    expect(saved.ok).toBe(true)
    expect(saved.offer.enabled).toBe(true)
    expect(saved.offer.stockId).toBe('st1')
    const got = await post('getCouponConfig', SUPER)
    expect(got.offer.label).toBe('开业')
  })

  it('大白话：回调地址不是 https 拒；证书没配齐推回调失败', async () => {
    expect((await post('saveCouponConfig', SUPER, { offer: { notifyUrl: 'http://x' } })).error).toBe('BAD_NOTIFY_URL')
    await post('saveCouponConfig', SUPER, { offer: { brandId: '120344', notifyUrl: 'https://x/couponNotify' } })
    const r = await post('setCouponNotifyUrl', SUPER)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('NO_BRAND_CERT')
  })

  it('大白话：证书齐了就把 notify-configs 打出去（mock，不真调）', async () => {
    await post('saveCouponConfig', SUPER, { offer: { brandId: '120344', notifyUrl: 'https://x/couponNotify' } })
    await post('saveSecureConfig', SUPER, {
      docId: 'wxbrand',
      fields: {
        brandPrivateKey: pair.privateKey,
        brandSerial: 'SER',
        wxpayPublicKeyId: 'PUB_KEY_ID_X',
      },
    })
    const urls: string[] = []
    setBrandFetchForTest(async (url) => {
      urls.push(url)
      return { status: 200, text: async () => '{}' }
    })
    const r = await post('setCouponNotifyUrl', SUPER)
    expect(r.ok).toBe(true)
    expect(urls[0]).toContain('/brand/marketing/product-coupon/notify-configs')
  })
})
