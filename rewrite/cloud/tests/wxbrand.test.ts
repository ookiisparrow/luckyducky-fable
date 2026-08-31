import { generateKeyPairSync, createSign, createCipheriv, createVerify } from 'crypto'
import { describe, it, expect, afterEach } from 'vitest'
import {
  wxbrandSign,
  brandSendPath,
  brandConfirmPath,
  BRAND_NOTIFY_PATH,
  sendProductCoupon,
  confirmProductCoupon,
  setProductCouponNotifyUrl,
  verifyBrandNotify,
  decryptBrandResource,
  couponReqNo,
  setBrandFetchForTest,
  type BrandCreds,
} from '../src/kit/wxbrand'
import type { WxFetch } from '../src/kit/wxpay'

const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const creds: BrandCreds = {
  brandId: '120344',
  privateKey: pair.privateKey,
  serial: 'BRANDSERIAL',
  publicKeyId: 'PUB_KEY_ID_TEST',
  publicKey: pair.publicKey,
  apiKey: 'k'.repeat(32),
}

function captureFetch(status = 200, json: unknown = { coupon_code: 'Code_1' }): { impl: WxFetch; calls: { url: string; init?: any }[] } {
  const calls: { url: string; init?: any }[] = []
  const impl: WxFetch = async (url, init) => {
    calls.push({ url, init })
    return { status, text: async () => JSON.stringify(json) }
  }
  return { impl, calls }
}

afterEach(() => setBrandFetchForTest())

describe('wxbrandSign', () => {
  it('大白话：品牌头前缀对、带 brand_id，签名能用同一把私钥验过', () => {
    const auth = wxbrandSign({
      method: 'POST',
      urlPath: BRAND_NOTIFY_PATH,
      body: '{"notify_url":"https://x"}',
      brandId: '120344',
      serial: 'BRANDSERIAL',
      privateKey: pair.privateKey,
      timestamp: '1700000000',
      nonce: 'n1',
    })
    expect(auth.startsWith('WECHATPAY-BRAND-SHA256-RSA2048 ')).toBe(true)
    expect(auth).toContain('brand_id="120344"')
    expect(auth).toContain('serial_no="BRANDSERIAL"')
    const sig = /signature="([^"]+)"/.exec(auth)?.[1] || ''
    const ok = createVerify('RSA-SHA256')
      .update('POST\n' + BRAND_NOTIFY_PATH + '\n1700000000\nn1\n{"notify_url":"https://x"}\n')
      .verify(pair.publicKey, sig, 'base64')
    expect(ok).toBe(true)
  })
})

describe('商品券出站路径（不真调微信）', () => {
  it('大白话：设回调 / 发券 / 确认三条路都打品牌商品券 path，不走商家券', async () => {
    const { impl, calls } = captureFetch()
    await setProductCouponNotifyUrl('https://example.com/couponNotify', creds, impl)
    await sendProductCoupon(
      { openid: 'o1', productCouponId: 'pc1', stockId: 'st1', appid: 'wx1', sendRequestNo: 's123456' },
      creds,
      impl
    )
    await confirmProductCoupon(
      { openid: 'o1', couponCode: 'C1', productCouponId: 'pc1', stockId: 'st1', appid: 'wx1', outRequestNo: 'c123456' },
      creds,
      impl
    )
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      BRAND_NOTIFY_PATH,
      brandSendPath('o1'),
      brandConfirmPath('o1', 'C1'),
    ])
    expect(calls.every((c) => c.init?.headers?.Authorization?.startsWith('WECHATPAY-BRAND-SHA256-RSA2048'))).toBe(true)
    expect(JSON.stringify(calls)).not.toMatch(/busifavor|sendCoupon/)
  })

  it('大白话：微信回非 200 不抛、带回错误码', async () => {
    const { impl } = captureFetch(400, { code: 'PARAM_ERROR' })
    const r = await sendProductCoupon(
      { openid: 'o1', productCouponId: 'pc1', stockId: 'st1', appid: 'wx1', sendRequestNo: 's123456' },
      creds,
      impl
    )
    expect(r.ok).toBe(false)
    expect(r.error).toBe('BRAND_400')
  })
})

describe('回调验签与解密', () => {
  it('大白话：真签通过，探测流量和坏签一律拒', () => {
    const body = '{"id":"1"}'
    const timestamp = '1700000000'
    const nonce = 'n2'
    const signature = createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${body}\n`).sign(pair.privateKey, 'base64')
    expect(verifyBrandNotify({ timestamp, nonce, body, signature, publicKey: pair.publicKey })).toBe(true)
    expect(verifyBrandNotify({ timestamp, nonce, body, signature: 'WECHATPAY/SIGNTEST/x', publicKey: pair.publicKey })).toBe(false)
    expect(verifyBrandNotify({ timestamp, nonce, body, signature: 'nope', publicKey: pair.publicKey })).toBe(false)
  })

  it('大白话：品牌 API 密钥能解开 AES-GCM 密文', () => {
    const plain = '{"openid":"o1","coupon_code":"C1"}'
    const nonce = '123456789012'
    const aad = 'coupon'
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(creds.apiKey), Buffer.from(nonce))
    cipher.setAAD(Buffer.from(aad))
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const packed = Buffer.concat([enc, cipher.getAuthTag()]).toString('base64')
    expect(decryptBrandResource({ apiKey: creds.apiKey, ciphertext: packed, nonce, associatedData: aad })).toBe(plain)
    expect(decryptBrandResource({ apiKey: 'short', ciphertext: packed, nonce, associatedData: aad })).toBeNull()
  })
})

describe('couponReqNo', () => {
  it('大白话：同一种子同一号，长度落在微信 6-40 档', () => {
    expect(couponReqNo('s', 'a')).toBe(couponReqNo('s', 'a'))
    expect(couponReqNo('s', 'a')).not.toBe(couponReqNo('s', 'b'))
    expect(couponReqNo('s', 'a').length).toBe(32)
  })
})
