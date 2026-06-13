import { reply, ensure, str, type Ctx } from '../lib'

// —— 二维码卡片 + 设置（规格 §六/§七 步骤⑤⑥）——
export async function getSettings({ db }: Ctx) {
  const got = await db.collection('adminConfig').doc('settings').get().catch(() => null)
  return reply(200, { ok: true, settings: got?.data || {} })
}

export async function saveSettings({ db, data }: Ctx) {
  const urlPrefix = String(data.urlPrefix || '').slice(0, 200)
  await ensure(db, 'adminConfig')
  const coll = db.collection('adminConfig')
  await coll
    .doc('settings')
    .set({ data: { urlPrefix, updatedAt: Date.now() } })
    .catch(async () => {
      await coll.add({ data: { _id: 'settings', urlPrefix, updatedAt: Date.now() } })
    })
  return reply(200, { ok: true })
}

export async function getCard({ db, cloud, data }: Ctx) {
  const productId = String(data.productId || '')
  if (!productId) return reply(400, { ok: false, error: 'NO_PRODUCT' })
  await ensure(db, 'cards')
  const got = await db.collection('cards').doc(`card-${productId}`).get().catch(() => null)
  let card: any = got?.data || null
  // 旧单面结构 → 双面结构（兼容已存草稿）
  if (card && !card.front) {
    card = {
      ...card,
      front: { art: card.art || '', bg: card.bgColor || '#f6e9b8', showBrand: true },
      back: {
        bg: '#ffffff',
        texts: { ...(card.texts || {}), warning: '提示：激活课程后，该商品将不再支持退货' },
        brandText: 'Lucky Ducky · 幸运小鸭',
      },
    }
  }
  let artUrl = ''
  const art = card?.front?.art
  if (art && art.startsWith('cloud://')) {
    const r = await cloud.getTempFileURL({ fileList: [art] })
    artUrl = r.fileList[0]?.tempFileURL || ''
  }
  return reply(200, { ok: true, card, artUrl })
}

export async function saveCard({ db, data }: Ctx) {
  const c = data.card
  if (!c || !c.productId) return reply(400, { ok: false, error: 'BAD_CARD' })
  const hex = (v: any, dft: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : dft)
  const doc = {
    productId: str(c.productId, 40),
    courseId: str(c.courseId, 40),
    name: str(c.name, 60),
    status: c.status === 'final' ? 'final' : 'draft',
    front: {
      art: str(c.front?.art, 300),
      bg: hex(c.front?.bg, '#f6e9b8'),
      showBrand: c.front?.showBrand !== false,
    },
    back: {
      bg: hex(c.back?.bg, '#ffffff'),
      texts: {
        title: str(c.back?.texts?.title, 40),
        sub: str(c.back?.texts?.sub, 60),
        scanHint: str(c.back?.texts?.scanHint, 30),
        warning: str(c.back?.texts?.warning, 50),
      },
      brandText: str(c.back?.brandText, 30),
    },
    sizeMM: {
      w: Math.min(300, Math.max(40, Number(c.sizeMM?.w) || 90)),
      h: Math.min(300, Math.max(40, Number(c.sizeMM?.h) || 54)),
    },
    updatedAt: Date.now(),
  }
  await ensure(db, 'cards')
  const coll = db.collection('cards')
  const id = `card-${doc.productId}`
  await coll
    .doc(id)
    .set({ data: doc })
    .catch(async () => {
      await coll.add({ data: { ...doc, _id: id } })
    })
  return reply(200, { ok: true })
}
