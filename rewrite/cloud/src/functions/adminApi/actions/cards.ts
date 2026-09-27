import { ensure, readDoc, type Ctx } from '../lib'
import { setOrAdd, str, err, ok } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// —— 二维码卡片 + 设置 ——
export async function getSettings({ db }: Ctx) {
  const got = await readDoc(db.collection(COLLECTIONS.adminConfig).doc('settings').get())
  if (!got.ok) return err('DOC_READ_FAIL')
  // webhook 带 key，拿到整条就能往群里发消息：只回「配了没 + 尾号」供页面辨认，原值不出云端
  const { alertWebhook, ...settings } = (got.data as Record<string, any>) || {}
  if (alertWebhook) Object.assign(settings, { alertWebhookSet: true, alertWebhookTail: String(alertWebhook).slice(-4) })
  return ok({ settings })
}

// 合并保存（非整存覆盖）：urlPrefix(步骤⑥) 与 alertWebhook/alertEvents(消息通知) 各自分别保存、互不抹除。
export async function saveSettings({ db, data }: Ctx) {
  await ensure(db, COLLECTIONS.adminConfig)
  const coll = db.collection(COLLECTIONS.adminConfig)
  const got = await readDoc(coll.doc('settings').get())
  if (!got.ok) return err('DOC_READ_FAIL') // 读失败≠空配置：停写，不拿 {} 合并覆盖
  // 去掉 get 回来的 _id：真 sdk doc(id).set({data}) 的 data 含 _id 即 reject（_id 由 doc(id) 指定）——
  // 不剥则二次保存（doc 已存在·get 带回 _id）必 500（根因#8 桩≠真 SDK 藏过，现测试桩同样拒）。
  const { _id: _omitId, ...cur } = (got.data as Record<string, any>) || {}
  const patch: Record<string, any> = { updatedAt: Date.now() }
  if (data.urlPrefix !== undefined) patch.urlPrefix = str(data.urlPrefix, 200)
  // 页面拿不到原值（getSettings 不回显），所以空串＝保持原值；清除要显式传 null（退回纯日志告警）
  if (data.alertWebhook === null) patch.alertWebhook = ''
  else if (data.alertWebhook) {
    const w = str(data.alertWebhook, 300)
    if (!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]+$/.test(w)) return err('BAD_WEBHOOK')
    patch.alertWebhook = w
  }
  if (data.alertEvents && typeof data.alertEvents === 'object') patch.alertEvents = data.alertEvents
  const next = { ...cur, ...patch }
  await setOrAdd(coll, 'settings', next)
  return ok()
}

export async function getCard({ db, cloud, data }: Ctx) {
  const productId = str(data.productId, 200)
  if (!productId) return err('NO_PRODUCT')
  await ensure(db, COLLECTIONS.cards)
  const got = await readDoc(db.collection(COLLECTIONS.cards).doc(`card-${productId}`).get())
  if (!got.ok) return err('DOC_READ_FAIL')
  let card: any = got.data
  // 旧单面结构 → 双面结构（兼容已存草稿）
  if (card && !card.front) {
    card = {
      ...card,
      front: { art: card.art || '', bg: card.bgColor || '#f6e9b8', showBrand: true },
      back: {
        bg: '#ffffff',
        texts: { ...(card.texts || {}), warning: '提示：激活课程后，该商品将不再支持退货' },
        brandText: 'Lucky Ducky · 小棉鸭',
      },
    }
  }
  let artUrl = ''
  const art = card?.front?.art
  if (art && art.startsWith('cloud://')) {
    const r = await cloud.getTempFileURL({ fileList: [art] })
    artUrl = r.fileList[0]?.tempFileURL || ''
  }
  return ok({ card, artUrl })
}

export async function saveCard({ db, data }: Ctx) {
  const c = data.card
  if (!c || !c.productId) return err('BAD_CARD')
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
  await ensure(db, COLLECTIONS.cards)
  const coll = db.collection(COLLECTIONS.cards)
  const id = `card-${doc.productId}`
  await setOrAdd(coll, id, doc)
  return ok()
}
