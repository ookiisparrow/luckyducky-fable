import cloud from 'wx-server-sdk'
import { getDb, throttleLocked, throttleFail, throttleReset } from '../../../kit'
import { reply, ensure, checkKey, type Ctx } from './lib'
import * as products from './actions/products'
import * as courses from './actions/courses'
import * as cards from './actions/cards'
import * as batches from './actions/batches'
import * as content from './actions/content'
import * as orders from './actions/orders'
import * as refunds from './actions/refunds'
import * as dashboard from './actions/dashboard'
import * as inventory from './actions/inventory'

// 管理控制台后端（HTTP 访问服务触发）。B5b：HTTP 外壳 + 口令闸在此，28+ action 拆 actions/ 查表。
// 鉴权：管理口令（adminConfig sha256，首登 bootstrap）。db 经 kit.getDb；退款流经 kit.callFlow。
const db = getDb()

// action → handler 查表（拆分前后清单一致；拆分时按此核对 diff）
const ACTIONS: Record<string, (ctx: Ctx) => Promise<any>> = {
  // 商品草稿 / 上架 / 橱窗
  listDrafts: products.listDrafts,
  saveDraft: products.saveDraft,
  deleteDraft: products.deleteDraft,
  uploadImage: products.uploadImage,
  publishProduct: products.publishProduct,
  unpublishProduct: products.unpublishProduct,
  republishProduct: products.republishProduct,
  listShowcase: products.listShowcase,
  saveShowcase: products.saveShowcase,
  // 课程草稿 / 发布 / 视频
  getVideoUploadMeta: courses.getVideoUploadMeta,
  getCourseDraft: courses.getCourseDraft,
  saveCourseDraft: courses.saveCourseDraft,
  publishCourse: courses.publishCourse,
  uploadChunk: courses.uploadChunk,
  uploadFinish: courses.uploadFinish,
  // 卡片 / 设置
  getSettings: cards.getSettings,
  saveSettings: cards.saveSettings,
  getCard: cards.getCard,
  saveCard: cards.saveCard,
  // 码批次
  listBatches: batches.listBatches,
  createBatch: batches.createBatch,
  listBatchCodes: batches.listBatchCodes,
  // 首页内容
  getHomeContent: content.getHomeContent,
  saveHomeContent: content.saveHomeContent,
  // 订单发货
  listOrders: orders.listOrders,
  shipOrder: orders.shipOrder,
  clearFeeMismatch: orders.clearFeeMismatch,
  // 售后退款
  listRefunds: refunds.listRefunds,
  approveRefund: refunds.approveRefund,
  rejectRefund: refunds.rejectRefund,
  // 看板
  getDashboard: dashboard.getDashboard,
  // 库存（库存#1）
  listInventory: inventory.listInventory,
  saveStock: inventory.saveStock,
}

// 认证频控（根因#13 防爆破）：失败 5 次/10 分 → 锁 5 分；login 与其余 action 的口令校验共用此闸。
const ADMIN_THROTTLE = { max: 5, windowMs: 10 * 60_000, lockMs: 5 * 60_000 }
// 频控键：尽力取客户端 IP（网关 x-forwarded-for），取不到回落 global。
// 注：x-forwarded-for 可伪造、per-IP 非绝对；但配合锁定窗口已令口令爆破不可行（5 次/5 分 ≈ 1440 次/天）。
function clientKey(event: any): string {
  const h = event.headers || {}
  const xff = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '')
  const ip = xff.split(',')[0].trim() || String(h['x-real-ip'] || h['X-Real-Ip'] || '')
  return 'adminlogin:' + (ip || 'global')
}

export const main = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, {})
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'POST_ONLY' })

  let req: any
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body
    req = JSON.parse(raw || '{}')
  } catch {
    return reply(400, { ok: false, error: 'BAD_JSON' })
  }
  const { action, key, data = {} } = req

  if (action === 'ping') return reply(200, { ok: true, ts: Date.now() })

  // 认证频控闸（根因#13）：口令校验前先查锁定——爆破到阈值即拒，不再放行任何口令尝试
  const tkey = clientKey(event)
  const wait = await throttleLocked(tkey)
  if (wait > 0) return reply(429, { ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfter: Math.ceil(wait / 1000) })

  if (action === 'login') {
    const res = await checkKey(db, key, true)
    if (res.ok) await throttleReset(tkey)
    else await throttleFail(tkey, ADMIN_THROTTLE)
    return reply(res.ok ? 200 : 401, res)
  }

  // 其余 action 一律先验口令（同受频控，防经任一 action 入口爆破）
  const auth = await checkKey(db, key, false)
  if (!auth.ok) {
    await throttleFail(tkey, ADMIN_THROTTLE)
    return reply(401, auth)
  }
  await throttleReset(tkey)
  await ensure(db, 'productsDraft')
  const drafts = db.collection('productsDraft')

  const handler = ACTIONS[action]
  if (!handler) return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  try {
    return await handler({ db, cloud, data, drafts })
  } catch (e) {
    console.error('adminApi error', action, e)
    return reply(500, { ok: false, error: 'SERVER_ERROR' })
  }
}
