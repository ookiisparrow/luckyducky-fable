import cloud from 'wx-server-sdk'
import { getDb, throttleLocked, throttleFail, throttleReset, recordAudit, shouldAudit } from '../../../kit'
import { reply, ensure, checkKey, type Ctx } from './lib'
import * as products from './actions/products'
import * as courses from './actions/courses'
import * as cards from './actions/cards'
import * as batches from './actions/batches'
import * as content from './actions/content'
import * as orders from './actions/orders'
import * as refunds from './actions/refunds'
import * as dashboard from './actions/dashboard'
import * as reconciliation from './actions/reconciliation'
import * as wxbill from './actions/wxbill'
import * as inventory from './actions/inventory'
import * as customer360 from './actions/customer360'
import * as checkpoints from './actions/checkpoints'

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
  // 求助面板「辅助视频」（全局共用）
  listHelpVideos: content.listHelpVideos,
  saveHelpVideos: content.saveHelpVideos,
  // 订单发货
  listOrders: orders.listOrders,
  orderCounts: orders.orderCounts,
  getOrderDetail: orders.getOrderDetail,
  shipOrder: orders.shipOrder,
  shipOrders: orders.shipOrders,
  clearFeeMismatch: orders.clearFeeMismatch,
  // 售后退款
  listRefunds: refunds.listRefunds,
  refundCounts: refunds.refundCounts,
  getRefundDetail: refunds.getRefundDetail,
  approveRefund: refunds.approveRefund,
  rejectRefund: refunds.rejectRefund,
  // 看板
  getDashboard: dashboard.getDashboard,
  // 财务对账（S16·内部账）
  getReconciliation: reconciliation.getReconciliation,
  // 外部对账（S16·Batch 2）：拉微信交易账单落 wxBills
  downloadBill: wxbill.downloadBill,
  // 外部对账（S16·Batch 3）：我方付款单 ⋈ wxBills 逐笔比对
  getBillMatch: reconciliation.getBillMatch,
  // 库存（库存#1）
  listInventory: inventory.listInventory,
  saveStock: inventory.saveStock,
  // 客户360（B1.1·后台360工作站·只读聚合·越权面：ACTION_CAPS 能力闸 + FORCE_AUDIT 强制留痕）
  getCustomer360: customer360.getCustomer360,
  // 节点诊断·关键节点定义策展（B2.2·后台360工作站·admin 维护 def 节点+挽回办法）
  listCheckpoints: checkpoints.listCheckpoints,
  saveCheckpoints: checkpoints.saveCheckpoints,
}

// 能力闸（§1.5 RBAC·根因#3·别让单超管裸奔）：受限 action 须 principal 具备对应能力（'*'=全能力）。
// 360 读他人全貌＝customer:view。守卫 cs-360-rbac-gated 焊本表含 getCustomer360 + 下方 caps 校验。
const ACTION_CAPS: Record<string, string> = { getCustomer360: 'customer:view' }

// 认证频控（根因#13 防爆破）：失败 5 次/10 分 → 锁 5 分；login 与其余 action 的口令校验共用此闸。
const ADMIN_THROTTLE = { max: 5, windowMs: 10 * 60_000, lockMs: 5 * 60_000 }
// 全局/账户级失败计数兜底（审核 P1）：x-forwarded-for 可伪造，攻击者每次换 IP 可让 per-IP 永不达 5 次锁。
// 故叠加跨所有 IP 的全局计数——阈值更高（单管理员正常极少触发），轮换伪造 header 的爆破累计达此阈仍锁。
// 代价：全局锁期间所有 admin 登录受阻（攻击者可借此短时 DoS 真管理员），但 lockMs 仅 5 分自愈、控制台内部用，可接受。
const ADMIN_THROTTLE_GLOBAL = { max: 20, windowMs: 10 * 60_000, lockMs: 5 * 60_000 }
const GLOBAL_KEY = 'adminlogin:global'
// 频控键：尽力取客户端 IP（网关 x-forwarded-for），取不到回落 global。
// 注：x-forwarded-for 可伪造、per-IP 非绝对——故配 GLOBAL_KEY 全局兜底；per-IP 仍给正常用户细粒度隔离。
function clientKey(event: any): string {
  const h = event.headers || {}
  const xff = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '')
  const ip = xff.split(',')[0].trim() || String(h['x-real-ip'] || h['X-Real-Ip'] || '')
  return 'adminlogin:' + (ip || 'global')
}

// 锁定检查：per-IP 或 全局任一锁定即拒（全局兜 x-forwarded-for 轮换爆破·审核 P1）。返回较长的剩余锁定毫秒。
async function throttleGate(tkey: string): Promise<number> {
  const [ipWait, globalWait] = await Promise.all([throttleLocked(tkey), throttleLocked(GLOBAL_KEY)])
  return Math.max(ipWait, globalWait)
}
// 记一次认证失败：per-IP 与 全局两个维度同时累加（全局兜底防轮换伪造 header·审核 P1）。
async function throttleFailBoth(tkey: string): Promise<void> {
  await throttleFail(tkey, ADMIN_THROTTLE)
  await throttleFail(GLOBAL_KEY, ADMIN_THROTTLE_GLOBAL)
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

  // 认证频控闸（根因#13）：口令校验前先查锁定——per-IP 或全局任一到阈即拒（全局兜轮换伪造 header·审核 P1）
  const tkey = clientKey(event)
  const wait = await throttleGate(tkey)
  if (wait > 0) return reply(429, { ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfter: Math.ceil(wait / 1000) })

  if (action === 'login') {
    const res = await checkKey(db, key, true)
    if (res.ok) await throttleReset(tkey) // 成功只清 per-IP；全局计数靠滚动窗口自然衰减（不被单次成功抹平·防分布式爆破信号丢失）
    else await throttleFailBoth(tkey)
    return reply(res.ok ? 200 : 401, res)
  }

  // 其余 action 一律先验口令（同受频控，防经任一 action 入口爆破）
  const auth = await checkKey(db, key, false)
  if (!auth.ok) {
    await throttleFailBoth(tkey)
    return reply(401, auth)
  }
  await throttleReset(tkey)
  // 能力闸（§1.5·根因#3·别让单超管裸奔）：受 ACTION_CAPS 限的 action 校验 caps（'*'=全能力）；无能力即 403。
  const caps: string[] = Array.isArray((auth as any).caps) ? (auth as any).caps : []
  const needCap = ACTION_CAPS[action]
  if (needCap && !caps.some((c) => c === '*' || c === needCap))
    return reply(403, { ok: false, error: 'FORBIDDEN' })
  await ensure(db, 'productsDraft')
  const drafts = db.collection('productsDraft')

  const handler = ACTIONS[action]
  if (!handler) return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  const auditIp = tkey.replace('adminlogin:', '') // 操作审计#4：动钱/状态操作留痕（fail-soft·不反噬响应）
  try {
    const res = await handler({ db, cloud, data, drafts })
    if (shouldAudit(action)) await recordAudit({ action, ip: auditIp, data, ok: !!res && res.statusCode === 200 })
    return res
  } catch (e) {
    if (shouldAudit(action)) await recordAudit({ action, ip: auditIp, data, ok: false, error: 'SERVER_ERROR' })
    console.error('adminApi error', action, e)
    return reply(500, { ok: false, error: 'SERVER_ERROR' })
  }
}
