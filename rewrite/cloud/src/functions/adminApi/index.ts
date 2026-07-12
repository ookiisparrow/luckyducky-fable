import cloud from 'wx-server-sdk'
import { getDb, throttleLocked, throttleFail, throttleReset, recordAudit, shouldAudit } from '../../kit'
import { reply, ensure, checkKey, issueSession, type Ctx } from './lib'
import * as products from './actions/products'
import * as courses from './actions/courses'
import * as cards from './actions/cards'
import * as batches from './actions/batches'
import * as content from './actions/content'
import * as ordersA from './actions/orders'
import * as refunds from './actions/refunds'
import * as dashboard from './actions/dashboard'
import * as reconciliation from './actions/reconciliation'
import * as wxbill from './actions/wxbill'
import * as inventoryA from './actions/inventory'
import * as customer360 from './actions/customer360'
import * as checkpoints from './actions/checkpoints'
import * as conversations from './actions/conversations'
import * as kb from './actions/kb'
import * as csat from './actions/csat'
import * as agentDesk from './actions/agentDesk'
import * as agents from './actions/agents'
import * as wecomLogin from './actions/wecomLogin'
import * as scmMaterials from './actions/scmMaterials'
import * as scmPurchase from './actions/scmPurchase'
import * as scmOutwork from './actions/scmOutwork'
import * as scmBom from './actions/scmBom'
import * as scmAssembly from './actions/scmAssembly'
import * as scmPlanner from './actions/scmPlanner'
import * as scmOverview from './actions/scmOverview'
import * as ops from './actions/ops'
import * as configChecklist from './actions/configChecklist'

// 管理控制台后端 v2（HTTP 访问服务触发·鉴权外壳逐字承接旧线 index.ts·批11 只挂 ping/login，
// 业务 action 后续批逐域挂进 ACTIONS/ACTION_CAPS——挂载时与旧线注册表逐行核对）。
// 鉴权：口令（adminConfig sha256·首登 bootstrap 须部署密钥）→ 会话令牌 fallback；RBAC 能力位默认拒；
// 认证频控 per-IP + 全局兜底。M5 切换日以新名部署、admin 前端切 endpoint。
const db = getDb()

// action → handler 查表（业务批逐域填充·与旧线注册表逐行核对）
const ACTIONS: Record<string, (ctx: Ctx) => Promise<any>> = {
  // 商品草稿 / 上架 / 橱窗（批12）
  listDrafts: products.listDrafts,
  saveDraft: products.saveDraft,
  deleteDraft: products.deleteDraft,
  uploadImage: products.uploadImage,
  publishProduct: products.publishProduct,
  unpublishProduct: products.unpublishProduct,
  republishProduct: products.republishProduct,
  listShowcase: products.listShowcase,
  saveShowcase: products.saveShowcase,
  // 课程草稿 / 发布 / 视频（批12）
  getVideoUploadMeta: courses.getVideoUploadMeta,
  getCourseDraft: courses.getCourseDraft,
  saveCourseDraft: courses.saveCourseDraft,
  publishCourse: courses.publishCourse,
  uploadChunk: courses.uploadChunk,
  uploadFinish: courses.uploadFinish,
  // 卡片 / 设置（批12）
  getSettings: cards.getSettings,
  saveSettings: cards.saveSettings,
  getCard: cards.getCard,
  saveCard: cards.saveCard,
  // 码批次（批12·createBatch 并行期经 callFunction 打旧线 genQrcodes 同名函数·M5 收口）
  listBatches: batches.listBatches,
  createBatch: batches.createBatch,
  listBatchCodes: batches.listBatchCodes,
  // 首页内容 / 辅助视频（批12）
  getHomeContent: content.getHomeContent,
  saveHomeContent: content.saveHomeContent,
  listHelpVideos: content.listHelpVideos,
  saveHelpVideos: content.saveHelpVideos,
  // 订单发货（批13）
  listOrders: ordersA.listOrders,
  orderCounts: ordersA.orderCounts,
  getOrderDetail: ordersA.getOrderDetail,
  shipOrder: ordersA.shipOrder,
  shipOrders: ordersA.shipOrders,
  clearFeeMismatch: ordersA.clearFeeMismatch,
  // 售后退款审批（批13）
  listRefunds: refunds.listRefunds,
  refundCounts: refunds.refundCounts,
  getRefundDetail: refunds.getRefundDetail,
  approveRefund: refunds.approveRefund,
  rejectRefund: refunds.rejectRefund,
  overrideRefund: refunds.overrideRefund,
  // 看板 / 对账 / 库存（批14）
  getDashboard: dashboard.getDashboard,
  getReconciliation: reconciliation.getReconciliation,
  getBillMatch: reconciliation.getBillMatch,
  downloadBill: wxbill.downloadBill,
  listInventory: inventoryA.listInventory,
  saveStock: inventoryA.saveStock,
  // 客户360（批15·只读·越权面：ACTION_CAPS 能力闸 + FORCE_AUDIT 强制留痕）
  getCustomer360: customer360.getCustomer360,
  searchCustomer: customer360.searchCustomer,
  getUser: customer360.getUser,
  // 节点诊断·关键节点定义策展（批15·admin 维护 def 节点+挽回办法）
  listCheckpoints: checkpoints.listCheckpoints,
  saveCheckpoints: checkpoints.saveCheckpoints,
  // 客服会话检索 + 质检报表（批15·检索过 customer:view 闸·报表 bounded 无逐人 PII 不设 cap）
  searchConversations: conversations.searchConversations,
  conversationsReport: conversations.conversationsReport,
  // 质检抽检（批 B7·未登记 ACTION_CAPS→默认拒 admin:write＝仅超管·坐席不可达·sampleQc/saveQcMark 写类自动审计）
  sampleQc: conversations.sampleQc,
  saveQcMark: conversations.saveQcMark,
  listQcSampled: conversations.listQcSampled,
  // 知识库（批15·FAQ 单源·admin 维护、客服 bot dispatch 读同一份）
  listKb: kb.listKb,
  saveKb: kb.saveKb,
  // 客服满意度报表（批15·只读·均分/分布·bounded）+ 明细钻取（批 B6·cursor 分页·未登记 cap→默认仅超管，同 getCsatReport）
  getCsatReport: csat.getCsatReport,
  listCsatEntries: csat.listCsatEntries,
  // 坐席台 10 action（批15·cap agent:handle·分配 scope 经 assertOwnedByAgent）
  listQueue: agentDesk.listQueue,
  claimConversation: agentDesk.claimConversation,
  releaseConversation: agentDesk.releaseConversation,
  sendAgentMessage: agentDesk.sendAgentMessage,
  getThread: agentDesk.getThread,
  getMediaUrl: agentDesk.getMediaUrl,
  setAgentStatus: agentDesk.setAgentStatus,
  escalateToMerchant: agentDesk.escalateToMerchant,
  closeConversation: agentDesk.closeConversation,
  listMyActive: agentDesk.listMyActive,
  getSessionCustomer360: agentDesk.getSessionCustomer360,
  // 外包账号管理（批15·未登记 ACTION_CAPS→默认拒 admin:write·天然仅超管建/停/列）
  createAgent: agents.createAgent,
  disableAgent: agents.disableAgent,
  listAgents: agents.listAgents,
  setAgentWecomUserId: agents.setAgentWecomUserId,
  // 进销存 SCM（批16·未登记 ACTION_CAPS→默认拒 admin:write＝仅超管·写类自动审计）
  // 地基：物料/供应商主档 + 期初盘点/调整（经门1 kit/scmStock）+ 流水查账
  listMaterials: scmMaterials.listMaterials,
  saveMaterial: scmMaterials.saveMaterial,
  listSuppliers: scmMaterials.listSuppliers,
  saveSupplier: scmMaterials.saveSupplier,
  adjustStock: scmMaterials.adjustStock,
  listLedger: scmMaterials.listLedger,
  // 车道 A·采购线：状态机 draft→ordered→received（首次流转绑门1 入库）+cancelled·totalFen 服务端算
  listPurchases: scmPurchase.listPurchases,
  savePurchase: scmPurchase.savePurchase,
  markOrdered: scmPurchase.markOrdered,
  receivePurchase: scmPurchase.receivePurchase,
  cancelPurchase: scmPurchase.cancelPurchase,
  // 车道 B·外协线：草稿→发料(出库)→收货(入带结+定格应付/损耗)→结算销账；仅 draft 可取消
  listOutworks: scmOutwork.listOutworks,
  saveOutwork: scmOutwork.saveOutwork,
  issueOutwork: scmOutwork.issueOutwork,
  receiveOutwork: scmOutwork.receiveOutwork,
  settleOutwork: scmOutwork.settleOutwork,
  cancelOutwork: scmOutwork.cancelOutwork,
  // 车道 C·配方组装线：全局模板+每产品差异位 → 组装执行（门3 resolveBom→快照冻结→门1 扣料→门4 produceStock 入成品·assemblyId 幂等）
  getBomSetup: scmBom.getBomSetup,
  saveBomTemplate: scmBom.saveBomTemplate,
  saveBomProfile: scmBom.saveBomProfile,
  previewAssembly: scmAssembly.previewAssembly,
  runAssembly: scmAssembly.runAssembly,
  listAssemblies: scmAssembly.listAssemblies,
  // 车道 D·计划核销线：备货计算器（只读）；发货核销流水绑 orders.shipOrder 首次 shipped 流转、不另立 action
  getRestockPlan: scmPlanner.getRestockPlan,
  // 产销统计（只读·同车道 D）：stockLedger fg 流水按 itemKey 汇总——打包累计 + 发货/销售累计，不动账
  getFgSummary: scmPlanner.getFgSummary,
  // 总览（批 B2）：低库存预警 + 应付未结按织女分组 + 在途采购/外协计数 + 最近流水——只读聚合着陆页
  getScmOverview: scmOverview.getScmOverview,
  // 运行期观测（批3·体检面板 + 异常账本·治病根#14 告警进人眼）：未登记 ACTION_CAPS→默认仅超管·
  // runInspect/resolveAnomaly 写类自动审计（不以 list/get 开头）·只读业务数据（只碰 inspectRuns/anomalies）
  runInspect: ops.runInspect,
  getInspectStatus: ops.getInspectStatus,
  listAnomalies: ops.listAnomalies,
  resolveAnomaly: ops.resolveAnomaly,
  // 人工配置清单（批 B9·只探测状态·零回显）：未登记 ACTION_CAPS→默认拒 admin:write＝仅超管
  getConfigChecklist: configChecklist.getConfigChecklist,
}

// 能力闸（RBAC·别让单超管裸奔）：受限 action 须 principal 具备对应能力（'*'=全能力）。
// 360 读他人全貌/检索＝customer:view；坐席台＝外包最小权 agent:handle（不含动钱/动状态/退款——留商户超管）。
const ACTION_CAPS: Record<string, string> = {
  getCustomer360: 'customer:view',
  searchCustomer: 'customer:view',
  getUser: 'customer:view',
  // 会话检索＝读他人会话全文越权面：复用 customer:view（同 360 读·不另立 cap）
  searchConversations: 'customer:view',
  listQueue: 'agent:handle',
  claimConversation: 'agent:handle',
  releaseConversation: 'agent:handle',
  sendAgentMessage: 'agent:handle',
  getThread: 'agent:handle',
  getMediaUrl: 'agent:handle',
  setAgentStatus: 'agent:handle',
  escalateToMerchant: 'agent:handle',
  closeConversation: 'agent:handle',
  listMyActive: 'agent:handle',
  // scoped 360：外包看「自己 claim 会话」对应 360 的唯一路径——cap 只需 agent:handle
  // （非 customer:view·那是无 scope 批量读面），action 内再过 assertOwnedByAgent + assertDataShareConsent 双闸
  getSessionCustomer360: 'agent:handle',
  // 快捷回复读知识库（kb=公司 FAQ·非客户 PII）：外包可读；saveKb 仍默认拒 admin:write（仅超管维护）
  listKb: 'agent:handle',
  // 越规退款（决策§26·退货管理权限）：单立 refund:manage 能力——超管 '*' 天然匹配，未来可给中间角色单授而不放全量 admin:write
  overrideRefund: 'refund:manage',
}
// 默认拒：未登记 ACTION_CAPS 的 action 须此高权默认 cap——非超管默认进不去钱/状态/管理 action。
const ADMIN_DEFAULT_CAP = 'admin:write'

// 认证频控（设计约束#13 防爆破）：失败 5 次/10 分 → 锁 5 分；login 与其余 action 的口令校验共用此闸。
const ADMIN_THROTTLE = { max: 5, windowMs: 10 * 60_000, lockMs: 5 * 60_000 }
// 全局失败计数兜底：x-forwarded-for 可伪造轮换让 per-IP 永不达阈——跨所有 IP 累计达此阈仍锁。
const ADMIN_THROTTLE_GLOBAL = { max: 20, windowMs: 10 * 60_000, lockMs: 5 * 60_000 }
const GLOBAL_KEY = 'adminlogin:global'

function clientKey(event: any): string {
  const h = event.headers || {}
  const xff = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '')
  const ip = xff.split(',')[0].trim() || String(h['x-real-ip'] || h['X-Real-Ip'] || '')
  return 'adminlogin:' + (ip || 'global')
}

async function throttleGate(tkey: string): Promise<number> {
  const [ipWait, globalWait] = await Promise.all([throttleLocked(tkey), throttleLocked(GLOBAL_KEY)])
  return Math.max(ipWait, globalWait)
}
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

  // 认证频控闸：口令校验前先查锁定——per-IP 或全局任一到阈即拒
  const tkey = clientKey(event)
  const wait = await throttleGate(tkey)
  if (wait > 0) return reply(429, { ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfter: Math.ceil(wait / 1000) })

  if (action === 'login') {
    const res = await checkKey(db, key, true)
    if (!res.ok) {
      await throttleFailBoth(tkey)
      return reply(401, res)
    }
    await throttleReset(tkey) // 成功只清 per-IP；全局计数靠滚动窗口自然衰减（防分布式爆破信号丢失）
    // 签发会话令牌（口令不落盘）：前端此后只存/只发令牌；签发失败如实返空、前端 fail-closed 拒登
    const docId = (res as any).agentId === 'admin' ? 'auth' : String((res as any).agentId || 'auth')
    const sessionToken = await issueSession(db, docId, 'pwd').catch(() => '')
    return reply(200, { ...res, sessionToken })
  }

  // 企微 OAuth 免登（pre-auth·坐席无口令·同 login 受频控防刷 code）：换 userid→查绑定账号→签发 session 令牌
  if (action === 'loginByWecomCode') {
    const res = await wecomLogin.loginByWecomCode({ db, data })
    if (res.statusCode === 200) await throttleReset(tkey)
    else await throttleFailBoth(tkey)
    return res
  }

  // 其余 action 一律先验口令/令牌（同受频控，防经任一 action 入口爆破）
  const auth = await checkKey(db, key, false)
  if (!auth.ok) {
    await throttleFailBoth(tkey)
    return reply(401, auth)
  }
  await throttleReset(tkey)
  // 能力闸·默认拒：登记的取 ACTION_CAPS、未登记默认高权 ADMIN_DEFAULT_CAP；超管 '*' 匹配一切
  const caps: string[] = Array.isArray((auth as any).caps) ? (auth as any).caps : []
  const needCap = ACTION_CAPS[action] || ADMIN_DEFAULT_CAP
  if (!caps.some((c) => c === '*' || c === needCap)) return reply(403, { ok: false, error: 'FORBIDDEN' })
  await ensure(db, 'productsDraft')
  const drafts = db.collection('productsDraft')

  const handler = ACTIONS[action]
  if (!handler) return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  const auditIp = tkey.replace('adminlogin:', '')
  const operator = String((auth as any).operator || 'admin') // 真实操作者身份·多账号可追溯
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

/** 业务批挂载口（后续批逐域填 ACTIONS/ACTION_CAPS·与旧线注册表逐行核对）。 */
export const registries = { ACTIONS, ACTION_CAPS }
