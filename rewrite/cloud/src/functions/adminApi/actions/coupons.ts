import { COLLECTIONS } from '@ldrw/shared'
import { reply, ensure, type Ctx } from '../lib'
import {
  loadCouponOffer,
  loadBrandCreds,
  parseOffer,
  setProductCouponNotifyUrl,
  brandFail,
  emptyOffer,
} from '../../../kit/wxbrand'

const OFFER_ID = 'offer'

export async function getCouponConfig({ db }: Ctx) {
  const offer = await loadCouponOffer(db)
  return reply(200, { ok: true, offer })
}

export async function saveCouponConfig({ db, data }: Ctx) {
  const incoming = (data && typeof data.offer === 'object' && data.offer) || data || {}
  const next = parseOffer({ ...emptyOffer(), ...incoming })
  if (next.notifyUrl && !/^https:\/\//.test(next.notifyUrl)) return reply(400, { ok: false, error: 'BAD_NOTIFY_URL' })
  await ensure(db, COLLECTIONS.couponConfig)
  const coll = db.collection(COLLECTIONS.couponConfig)
  const got = await coll.doc(OFFER_ID).get().catch(() => null)
  const { _id: _omitId, ...cur } = (got && got.data) || {}
  const doc = { ...cur, ...next, updatedAt: Date.now() }
  await coll
    .doc(OFFER_ID)
    .set({ data: doc })
    .catch(async () => {
      await coll.add({ data: { _id: OFFER_ID, ...doc } })
    })
  return reply(200, { ok: true, offer: parseOffer(doc) })
}

export async function setCouponNotifyUrl({ db }: Ctx) {
  const offer = await loadCouponOffer(db)
  if (!offer.notifyUrl) return reply(400, { ok: false, error: 'NO_NOTIFY_URL' })
  const creds = await loadBrandCreds(db)
  if (!creds.ok) return reply(400, { ok: false, error: creds.error })
  const r = await setProductCouponNotifyUrl(offer.notifyUrl, creds.creds)
  if (!r.ok) {
    await brandFail('setCouponNotifyUrl', r.error || 'NOTIFY_URL_FAIL', { status: r.status })
    return reply(502, { ok: false, error: r.error || 'NOTIFY_URL_FAIL' })
  }
  return reply(200, { ok: true })
}
