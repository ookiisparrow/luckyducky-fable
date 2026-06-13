import cloud from 'wx-server-sdk'
import { getDb } from '../../../kit'
import { reply, ensure, checkKey, type Ctx } from './lib'
import * as products from './actions/products'
import * as courses from './actions/courses'
import * as cards from './actions/cards'
import * as batches from './actions/batches'
import * as content from './actions/content'
import * as orders from './actions/orders'
import * as refunds from './actions/refunds'
import * as dashboard from './actions/dashboard'

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
  if (action === 'login') {
    const res = await checkKey(db, key, true)
    return reply(res.ok ? 200 : 401, res)
  }

  // 其余 action 一律先验口令
  const auth = await checkKey(db, key, false)
  if (!auth.ok) return reply(401, auth)
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
