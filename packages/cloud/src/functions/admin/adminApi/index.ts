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
import * as conversations from './actions/conversations'
import * as kb from './actions/kb'
import * as csat from './actions/csat'
import * as agentDesk from './actions/agentDesk' // 承面C 车道A·坐席台 8 action（B6·cap agent:handle）
import * as agents from './actions/agents' // 承面C 车道C·外包账号管理（B5.2·超管建/停/列·默认拒 admin:write）
import * as wecomLogin from './actions/wecomLogin' // M⑦ 车道B·企微 OAuth 免登（pre-auth·特殊分发·同 login 受频控）
import * as scmMaterials from './actions/scmMaterials' // 进销存 SCM-0 地基·物料/供应商主档+期初调整（默认拒 admin:write·仅超管）

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
  // 客户360（B1.1/1.2·后台360工作站·只读·越权面：ACTION_CAPS 能力闸 + FORCE_AUDIT 强制留痕）
  getCustomer360: customer360.getCustomer360, // 聚合全貌（provider registry）
  searchCustomer: customer360.searchCustomer, // 按 openid/手机/单号/昵称检索客户
  getUser: customer360.getUser, // 单 openid 用户画像（users 集合）
  // 节点诊断·关键节点定义策展（B2.2·后台360工作站·admin 维护 def 节点+挽回办法）
  listCheckpoints: checkpoints.listCheckpoints,
  saveCheckpoints: checkpoints.saveCheckpoints,
  // 客服会话检索（B5.1·后台360工作站·外包管控底座·只读·越权读：ACTION_CAPS customer:view 闸 + shouldAudit 默认留痕）
  searchConversations: conversations.searchConversations,
  // 客服质检报表（B5.3·后台360工作站·会话量/响应时长/SLA/答复率·bounded 聚合·运营统计无逐人 PII·同 dashboard 不设 cap 闸）
  conversationsReport: conversations.conversationsReport,
  // 知识库（B4.1·后台360工作站·FAQ/知识条目单源·admin 维护、客服 bot dispatch 读同一份）
  listKb: kb.listKb,
  saveKb: kb.saveKb,
  // 客服满意度报表（B4.3·后台360工作站·只读·均分/分布·bounded）
  getCsatReport: csat.getCsatReport,
  // 承面C 车道A·坐席台 8 action（B6·§1 定稿·cap agent:handle·ACTION_CAPS 已标·分配 scope 经 assertOwnedByAgent）
  listQueue: agentDesk.listQueue,
  claimConversation: agentDesk.claimConversation,
  releaseConversation: agentDesk.releaseConversation,
  sendAgentMessage: agentDesk.sendAgentMessage,
  getThread: agentDesk.getThread,
  setAgentStatus: agentDesk.setAgentStatus,
  escalateToMerchant: agentDesk.escalateToMerchant,
  closeConversation: agentDesk.closeConversation,
  listMyActive: agentDesk.listMyActive, // 在接会话恢复（刷新不丢·follow-up ②）
  getSessionCustomer360: agentDesk.getSessionCustomer360, // 外包 scoped 360 读路径（双闸·follow-up ①）
  // 承面C 车道C·外包账号管理（B5.2·未登记 ACTION_CAPS→默认拒 admin:write·天然仅超管建/停/列·外包无权）
  createAgent: agents.createAgent,
  disableAgent: agents.disableAgent,
  listAgents: agents.listAgents,
  setAgentWecomUserId: agents.setAgentWecomUserId, // M⑦ 地基·回填企微 userid（免登用·默认拒 admin:write·仅超管）
  // 进销存 SCM-0 地基（蓝图 docs/进销存ERP/·门5 文件级隔离·未登记 ACTION_CAPS→默认拒 admin:write＝仅超管·
  // 写类自动审计）：物料/供应商主档 + 期初盘点/调整（经门1 kit/scmStock）+ 流水查账
  listMaterials: scmMaterials.listMaterials,
  saveMaterial: scmMaterials.saveMaterial,
  listSuppliers: scmMaterials.listSuppliers,
  saveSupplier: scmMaterials.saveSupplier,
  adjustStock: scmMaterials.adjustStock,
  listLedger: scmMaterials.listLedger,
}

// 能力闸（§1.5 RBAC·根因#3·别让单超管裸奔）：受限 action 须 principal 具备对应能力（'*'=全能力）。
// 360 读他人全貌/检索＝customer:view。守卫 cs-360-rbac-gated 焊本表含三个 360 读 action + 下方 caps 校验。
const ACTION_CAPS: Record<string, string> = {
  getCustomer360: 'customer:view',
  searchCustomer: 'customer:view',
  getUser: 'customer:view',
  // 会话检索＝读他人会话全文越权面（B5.1·后台360工作站·车道 E）：复用 customer:view（同 360 读·不另立 cap）。
  // 守卫 conversations-pii-gated 独立焊本行（不动 cs-360-rbac-gated 那三行·并行整合取并集）。
  searchConversations: 'customer:view',
  // 承面 C 坐席台 8 action（B6·§1 定稿·外包最小权 agent:handle·根因#3）：查(listQueue/getThread)+回复(send)+
  // 认领/放手/升级/结束——**不含**动钱/动状态/退款（留商户超管·外包无权）。wire 与 actions/agentDesk.ts 同批落
  // （不空守·契约 shared/csAgentDesk.ts 头注要求）；未 gate 的 action 默认拒 ADMIN_DEFAULT_CAP（守卫 agent-rbac-gated）。
  listQueue: 'agent:handle',
  claimConversation: 'agent:handle',
  releaseConversation: 'agent:handle',
  sendAgentMessage: 'agent:handle',
  getThread: 'agent:handle',
  setAgentStatus: 'agent:handle',
  escalateToMerchant: 'agent:handle',
  closeConversation: 'agent:handle',
  listMyActive: 'agent:handle',
  // scoped 360（接真接口批·follow-up ①）：外包看「自己 claim 会话」对应 360 的唯一路径——cap 只需 agent:handle
  // （非 customer:view·那是无 scope 批量读面），action 内再过 assertOwnedByAgent + assertDataShareConsent 双闸。
  getSessionCustomer360: 'agent:handle',
  // 快捷回复读知识库（承面C 车道B·坐席台 QuickReplies 读 kb 发 FAQ）：外包 agent:handle 可读（kb=公司 FAQ·非客户 PII）；
  // saveKb 仍默认拒 admin:write（仅超管维护）。整合补：原 listKb 未标 cap→外包调不了（车道B 报的接缝缺口）。
  listKb: 'agent:handle',
}
// 默认拒（B5.2 坐席 RBAC·守卫 agent-rbac-gated）：未登记 ACTION_CAPS 的 action 须此高权默认 cap——
// 非超管角色（caps 不含 '*'/此 cap）默认进不去钱/状态/管理 action（外包/坐席不经未 gate 的 action 越权）。超管 ['*'] 匹配一切·行为不变。
const ADMIN_DEFAULT_CAP = 'admin:write'

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

  // M⑦ 车道B·企微 OAuth 免登（pre-auth·坐席无口令·同 login 受频控防刷 code）：换 userid→查绑定账号→签发 session 令牌。
  if (action === 'loginByWecomCode') {
    const res = await wecomLogin.loginByWecomCode({ db, data })
    if (res.statusCode === 200) await throttleReset(tkey)
    else await throttleFailBoth(tkey)
    return res
  }

  // 其余 action 一律先验口令（同受频控，防经任一 action 入口爆破）
  const auth = await checkKey(db, key, false)
  if (!auth.ok) {
    await throttleFailBoth(tkey)
    return reply(401, auth)
  }
  await throttleReset(tkey)
  // 能力闸·默认拒（§1.5·根因#3·别让单超管裸奔·B5.2）：每个 action 都需 cap——登记的取 ACTION_CAPS、
  // 未登记的默认高权 ADMIN_DEFAULT_CAP（防外包/坐席经未 gate 的 action 越权动钱/状态）。超管 '*' 匹配一切·行为不变。
  const caps: string[] = Array.isArray((auth as any).caps) ? (auth as any).caps : []
  const needCap = ACTION_CAPS[action] || ADMIN_DEFAULT_CAP
  if (!caps.some((c) => c === '*' || c === needCap))
    return reply(403, { ok: false, error: 'FORBIDDEN' })
  await ensure(db, 'productsDraft')
  const drafts = db.collection('productsDraft')

  const handler = ACTIONS[action]
  if (!handler) return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  const auditIp = tkey.replace('adminlogin:', '') // 操作审计#4：动钱/状态操作留痕（fail-soft·不反噬响应）
  // B5.4·§1.5 可追溯：真实操作者身份（checkKey 解析的账号 name/_id·多账号上线后不再糊成单口令 admin·谁查/改了谁）
  const operator = String((auth as any).operator || 'admin')
  // 承面 C 坐席台（§1.5·根因#3 不信前端）：认证坐席身份 + 能力位贯入 Ctx，供 agentDesk actions 做 claim 绑定/
  // 分配 scope/接待上限（agentId 取 checkKey 解析的账号身份·非 data 前端传入）。其余 action 忽略这两字段（附加·无副作用）。
  const agentId = String((auth as any).agentId || operator)
  try {
    const res = await handler({ db, cloud, data, drafts, agentId, caps })
    if (shouldAudit(action)) await recordAudit({ action, operator, ip: auditIp, data, ok: !!res && res.statusCode === 200 })
    return res
  } catch (e) {
    if (shouldAudit(action)) await recordAudit({ action, operator, ip: auditIp, data, ok: false, error: 'SERVER_ERROR' })
    console.error('adminApi error', action, e)
    return reply(500, { ok: false, error: 'SERVER_ERROR' })
  }
}
