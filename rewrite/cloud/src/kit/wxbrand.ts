import { createHash, createSign, createVerify, createDecipheriv, randomBytes } from 'crypto'
import { request } from 'https'
import { COLLECTIONS } from '@ldrw/shared'
import { normalizePem, type WxFetch } from './wxpay'
import { getSecureConfigFields } from './secureConfig'
import { getDb } from './db'
import { notifyAlert } from './observe'

/**
 * 微信支付品牌经营·商品券出站（品牌模式，不是商家券）。
 * 签名头 WECHATPAY-BRAND-SHA256-RSA2048；凭证走 secureConfig/wxbrand，业务码不直拼。
 * 官方：https://pay.weixin.qq.com/doc/brand/4016060894
 */

const WXPAY_HOST = 'https://api.mch.weixin.qq.com'
export const BRAND_NOTIFY_PATH = '/brand/marketing/product-coupon/notify-configs'
export const brandSendPath = (openid: string) => `/brand/marketing/product-coupon/users/${encodeURIComponent(openid)}/coupons`
export const brandConfirmPath = (openid: string, couponCode: string) =>
  `/brand/marketing/product-coupon/users/${encodeURIComponent(openid)}/coupons/${encodeURIComponent(couponCode)}/confirm`

const DEFAULT_APPID = 'wxcbd2fb68b81bcfb1'
const OFFER_ID = 'offer'

export type CouponOffer = {
  enabled: boolean
  label: string
  brandId: string
  productCouponId: string
  stockId: string
  notifyUrl: string
  appid: string
}

export type BrandCreds = {
  brandId: string
  privateKey: string
  serial: string
  publicKeyId: string
  publicKey: string
  apiKey: string
}

export type BrandSignOpts = {
  method: string
  urlPath: string
  body: string
  brandId: string
  serial: string
  privateKey: string
  timestamp?: string
  nonce?: string
}

let brandFetch: WxFetch = (url, init) =>

  new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request(
      { method: init?.method || 'GET', hostname: u.hostname, path: u.pathname + u.search, headers: init?.headers },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode || 0, text: async () => body }))
      }
    )
    req.setTimeout(30_000, () => req.destroy(new Error('TIMEOUT')))
    req.on('error', reject)
    if (init?.body) req.write(init.body)
    req.end()
  })

const liveBrandFetch = brandFetch
/** 测试注入 mock，避免真出站。生产不调用。 */
export function setBrandFetchForTest(fn?: WxFetch): void {
  brandFetch = fn || liveBrandFetch
}

/** 品牌 API Authorization：message 与商户 APIv3 同形，头前缀不同。 */
export function wxbrandSign(opts: BrandSignOpts): string {
  const timestamp = opts.timestamp || Math.floor(Date.now() / 1000).toString()
  const nonce = opts.nonce || randomBytes(16).toString('hex')
  const message = `${opts.method}\n${opts.urlPath}\n${timestamp}\n${nonce}\n${opts.body}\n`
  const signature = createSign('RSA-SHA256').update(message).sign(opts.privateKey, 'base64')
  return `WECHATPAY-BRAND-SHA256-RSA2048 brand_id="${opts.brandId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${opts.serial}"`
}

export function couponReqNo(tag: string, seed: string): string {
  return (tag + createHash('sha256').update(seed).digest('hex')).slice(0, 32)
}

export function emptyOffer(): CouponOffer {
  return { enabled: false, label: '', brandId: '', productCouponId: '', stockId: '', notifyUrl: '', appid: DEFAULT_APPID }
}

export function parseOffer(raw: Record<string, unknown> | null | undefined): CouponOffer {
  const d = raw || {}
  return {
    enabled: d.enabled === true,
    label: String(d.label || '').slice(0, 40),
    brandId: String(d.brandId || '').trim(),
    productCouponId: String(d.productCouponId || '').trim(),
    stockId: String(d.stockId || '').trim(),
    notifyUrl: String(d.notifyUrl || '').trim(),
    appid: String(d.appid || '').trim() || DEFAULT_APPID,
  }
}

export async function loadCouponOffer(db?: any): Promise<CouponOffer> {
  const got = await (db || getDb()).collection(COLLECTIONS.couponConfig).doc(OFFER_ID).get().catch(() => null)
  return parseOffer(got && got.data)
}

export async function loadBrandCreds(db?: any): Promise<{ ok: true; creds: BrandCreds } | { ok: false; error: string }> {
  const offer = await loadCouponOffer(db)
  if (!offer.brandId) return { ok: false, error: 'NO_BRAND_ID' }
  const f = await getSecureConfigFields(db || getDb(), 'wxbrand', [
    'brandPrivateKey',
    'brandSerial',
    'wxpayPublicKey',
    'wxpayPublicKeyId',
    'brandApiKey',
  ])
  const privateKey = normalizePem(f.brandPrivateKey || '')
  if (!privateKey || !f.brandSerial || !f.wxpayPublicKeyId) return { ok: false, error: 'NO_BRAND_CERT' }
  return {
    ok: true,
    creds: {
      brandId: offer.brandId,
      privateKey,
      serial: f.brandSerial,
      publicKeyId: f.wxpayPublicKeyId,
      publicKey: normalizePem(f.wxpayPublicKey || ''),
      apiKey: f.brandApiKey || '',
    },
  }
}

async function brandPost(
  urlPath: string,
  bodyObj: Record<string, unknown>,
  creds: BrandCreds,
  fetchImpl: WxFetch
): Promise<{ ok: boolean; status: number; json: any; error?: string }> {
  try {
    const body = JSON.stringify(bodyObj)
    const headers = {
      Authorization: wxbrandSign({
        method: 'POST',
        urlPath,
        body,
        brandId: creds.brandId,
        serial: creds.serial,
        privateKey: creds.privateKey,
      }),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Wechatpay-Serial': creds.publicKeyId,
      'User-Agent': 'luckyducky-brand/1.0',
    }
    const r = await fetchImpl(WXPAY_HOST + urlPath, { method: 'POST', headers, body })
    const text = await r.text().catch(() => '')
    let json: any = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { raw: text.slice(0, 200) }
    }
    if (r.status < 200 || r.status >= 300) {
      return { ok: false, status: r.status, json, error: `BRAND_${r.status}` }
    }
    return { ok: true, status: r.status, json }
  } catch (e: any) {
    return { ok: false, status: 0, json: {}, error: 'BRAND_FETCH_FAIL:' + String(e?.message || e).slice(0, 80) }
  }
}

export async function setProductCouponNotifyUrl(
  notifyUrl: string,
  creds: BrandCreds,
  fetchImpl: WxFetch = brandFetch
) {
  return brandPost(BRAND_NOTIFY_PATH, { notify_url: notifyUrl }, creds, fetchImpl)
}

export async function sendProductCoupon(
  o: { openid: string; productCouponId: string; stockId: string; appid: string; sendRequestNo: string },
  creds: BrandCreds,
  fetchImpl: WxFetch = brandFetch
) {
  return brandPost(
    brandSendPath(o.openid),
    {
      product_coupon_id: o.productCouponId,
      stock_id: o.stockId,
      appid: o.appid,
      send_request_no: o.sendRequestNo,
    },
    creds,
    fetchImpl
  )
}

export async function confirmProductCoupon(
  o: { openid: string; couponCode: string; productCouponId: string; stockId: string; appid: string; outRequestNo: string },
  creds: BrandCreds,
  fetchImpl: WxFetch = brandFetch
) {
  return brandPost(
    brandConfirmPath(o.openid, o.couponCode),
    {
      product_coupon_id: o.productCouponId,
      stock_id: o.stockId,
      appid: o.appid,
      out_request_no: o.outRequestNo,
    },
    creds,
    fetchImpl
  )
}

/** 回调解密后验签。探测流量（WECHATPAY/SIGNTEST/）一律当失败。 */
export function verifyBrandNotify(o: { timestamp: string; nonce: string; body: string; signature: string; publicKey: string }): boolean {
  const sig = String(o.signature || '')
  if (!sig || sig.startsWith('WECHATPAY/SIGNTEST/') || !o.publicKey) return false
  try {
    return createVerify('RSA-SHA256')
      .update(`${o.timestamp}\n${o.nonce}\n${o.body}\n`)
      .verify(o.publicKey, sig, 'base64')
  } catch {
    return false
  }
}

export function decryptBrandResource(o: { apiKey: string; ciphertext: string; nonce: string; associatedData: string }): string | null {
  try {
    const key = Buffer.from(String(o.apiKey || ''), 'utf8')
    if (key.length !== 32) return null
    const buf = Buffer.from(o.ciphertext, 'base64')
    if (buf.length < 17) return null
    const data = buf.subarray(0, buf.length - 16)
    const tag = buf.subarray(buf.length - 16)
    const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(o.nonce))
    if (o.associatedData) dec.setAAD(Buffer.from(o.associatedData))
    dec.setAuthTag(tag)
    return Buffer.concat([dec.update(data), dec.final()]).toString('utf8')
  } catch {
    return null
  }
}

export async function brandFail(fn: string, code: string, ctx: Record<string, unknown> = {}): Promise<void> {
  await notifyAlert('anomaly', fn, code, ctx)
}
