import { generateKeyPairSync, createSign, createCipheriv } from 'crypto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as couponNotify } from '../src/functions/callbacks/couponNotify/index'
import { setBrandFetchForTest, couponReqNo } from '../src/kit/wxbrand'

const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const API_KEY = 'k'.repeat(32)

function encrypt(plain: string) {
  const nonce = '123456789012'
  const aad = 'coupon'
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(API_KEY), Buffer.from(nonce))
  cipher.setAAD(Buffer.from(aad))
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { ciphertext: Buffer.concat([enc, cipher.getAuthTag()]).toString('base64'), nonce, associated_data: aad }
}

function signedEvent(bodyObj: unknown) {
  const body = JSON.stringify(bodyObj)
  const timestamp = '1700000000'
  const nonce = 'nn'
  const signature = createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${body}\n`).sign(pair.privateKey, 'base64')
  return {
    httpMethod: 'POST',
    headers: {
      'Wechatpay-Signature': signature,
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
    },
    body,
  }
}

beforeEach(() => {
  control.reset()
  control.seed('couponConfig', [{ _id: 'offer', brandId: '120344', appid: 'wx1' }])
  control.seed('secureConfig', [
    {
      _id: 'wxbrand',
      brandPrivateKey: pair.privateKey,
      brandSerial: 'SER',
      wxpayPublicKey: pair.publicKey,
      wxpayPublicKeyId: 'PUB_KEY_ID_X',
      brandApiKey: API_KEY,
    },
  ])
})
afterEach(() => setBrandFetchForTest())

describe('couponNotify', () => {
  it('大白话：坏签不确认；好签解密后确认发放，同一券码确认单号不变', async () => {
    const resource = encrypt(JSON.stringify({ openid: 'o1', coupon_code: 'C9', product_coupon_id: 'pc1', stock_id: 'st1' }))
    const bad = await couponNotify({ httpMethod: 'POST', headers: { 'Wechatpay-Signature': 'nope' }, body: '{}' })
    expect(JSON.parse(bad.body).code).toBe('FAIL')

    const paths: string[] = []
    const bodies: string[] = []
    setBrandFetchForTest(async (url, init) => {
      paths.push(new URL(url).pathname)
      bodies.push(String(init?.body || ''))
      return { status: 200, text: async () => '{}' }
    })
    const ev = signedEvent({ resource })
    const ok1 = await couponNotify(ev)
    const ok2 = await couponNotify(ev)
    expect(JSON.parse(ok1.body).code).toBe('SUCCESS')
    expect(JSON.parse(ok2.body).code).toBe('SUCCESS')
    expect(paths[0]).toBe('/brand/marketing/product-coupon/users/o1/coupons/C9/confirm')
    expect(JSON.parse(bodies[0]).out_request_no).toBe(couponReqNo('c', 'C9'))
    expect(JSON.parse(bodies[1]).out_request_no).toBe(JSON.parse(bodies[0]).out_request_no)
  })
})
