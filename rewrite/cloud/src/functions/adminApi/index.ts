import cloud from 'wx-server-sdk'
import { getDb, throttleLocked, throttleFail, throttleReset, recordAudit, shouldAudit, alert, notifyAlert } from '../../kit'
import { COLLECTIONS } from '@ldrw/shared'
import { reply, checkKey, issueSession, revokeSession, type Ctx } from './lib'
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
import * as secureConfig from './actions/secureConfig'
import * as reviews from './actions/reviews'

// 管理控制台后端 v2（HTTP 访问服务触发·鉴权外壳逐字承接旧线 index.ts·业务 action 已全域挂载
// 进 ACTIONS/ACTION_CAPS——与旧线注册表逐行核对过）。
// 鉴权：login 只认口令（首登 bootstrap 须部署密钥）签发会话令牌；其余 action 先认令牌、查无再比口令；RBAC 能力位默认拒；
// 认证频控 per-IP + 全局兜底。M5 切换日以新名部署、admin 前端切 endpoint。
const db = getDb()

// 空原型注册表（与 app 网关同式·根因#3）：普通对象字面量继承 Object.prototype，
// ACTIONS['constructor'/'toString'] 在鉴权通过后会被当成真 handler 调用。satisfies 保住字面量逐条签名校验。
const ACTIONS: Record<string, (ctx: Ctx) => Promise<any>> = Object.assign(Object.create(null), {
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
  // VOD 转码管线（决策§31 批2）：直传签名（get 前缀不审计）+ 转码同步（写草稿·自动审计）·默认 admin:write
  getVodUploadSignature: courses.getVodUploadSignature,
  syncVodMedia: courses.syncVodMedia,
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
  // 页面内容 CMS（批A·5 页可编辑：welcome/catalogPlayer/mePage/about/agreement）·默认 admin:write·save 非 get 前缀自动审计
  savePageContent: content.savePageContent,
  getPageContent: content.getPageContent,
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
  recordPaidFee: refunds.recordPaidFee,
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
  // 测版刷新（T1）：未登记 ACTION_CAPS→默认拒 admin:write＝仅超管；refresh 写类自动审计
  getTrialRefreshGate: conversations.getTrialRefreshGate,
  refreshTrialSession: conversations.refreshTrialSession,
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
  // 运行期观测（批3·体检面板 + 异常账本·治病根#14 告警进人眼 + 批 B6 净新增 listAudit 只读 auditLog·操作审计#4
  // 读出口）：未登记 ACTION_CAPS→默认仅超管·runInspect/resolveAnomaly 写类自动审计（不以 list/get 开头）·
  // 只读业务数据（只碰 inspectRuns/anomalies/auditLog）
  runInspect: ops.runInspect,
  getInspectStatus: ops.getInspectStatus,
  listAnomalies: ops.listAnomalies,
  resolveAnomaly: ops.resolveAnomaly,
  listAudit: ops.listAudit,
  // web 前端错误上报唯一落口（批 B7·治病根#14 client-error 通道 web 半边）：admin/agent errorReporter.ts 三件套
  // 捕获后打此 action；cap 复用 agent:handle（外包坐席台前端也要能报错），见 ACTION_CAPS 注释；不进 auditLog
  // （shouldAudit 已排除，见 kit/audit.ts）——它自己的账本是 anomalies。
  reportClientError: ops.reportClientError,
  // 人工配置清单（批 B9·只探测状态·零回显）：未登记 ACTION_CAPS→默认拒 admin:write＝仅超管
  getConfigChecklist: configChecklist.getConfigChecklist,
  // 人工配置清单可填写化（决策 2026-07-12）：写敏感凭证/支付接缝配置·未登记 ACTION_CAPS→默认拒 admin:write＝仅超管
  saveSecureConfig: secureConfig.saveSecureConfig,
  savePayConfig: secureConfig.savePayConfig,
  // 评价挑选（先审后发·未登记 ACTION_CAPS→默认拒 admin:write＝仅超管）
  listReviews: reviews.listReviews,
  setReviewPicked: reviews.setReviewPicked,
} satisfies Record<string, (ctx: Ctx) => Promise<any>>)

// 顶层兜底按 action 归因：action 名不带文件名，故沿 ACTIONS 的真实 handler 引用反查所属 action 文件，
// 再按模块归因。下表是 modules.json adminActionFiles 的镜像（云函数进不了 JSON）；未匹配的动态 action 回 unknown。
const ADMIN_ACTION_MODULES: Record<string, Record<string, unknown>[]> = {
  shop: [products, content, cards],
  orders: [ordersA, refunds, reconciliation, wxbill],
  learning: [courses, batches],
  cs: [agentDesk, agents, checkpoints, conversations, csat, customer360, kb, wecomLogin],
  scm: [scmAssembly, scmBom, scmMaterials, scmOutwork, scmOverview, scmPlanner, scmPurchase, inventoryA],
  ops: [ops, configChecklist, secureConfig, dashboard],
  reviews: [reviews],
}
const ADMIN_ACTION_MODULE_BY_NAME: Record<string, string> = Object.create(null)
for (const [mod, files] of Object.entries(ADMIN_ACTION_MODULES))
  for (const file of files)
    for (const [action, handler] of Object.entries(file))
      if (ACTIONS[action] === handler) ADMIN_ACTION_MODULE_BY_NAME[action] = mod

// 能力闸（RBAC·别让单超管裸奔）：受限 action 须 principal 具备对应能力（'*'=全能力）。值可为单 cap 或
// cap 数组（「任一命中」语义·C4）——数组内任一 cap 命中即放行。
// 360 读他人全貌/检索＝customer:view；坐席台＝外包最小权 agent:handle（不含动钱/动状态/退款——留商户超管）。
const ACTION_CAPS: Record<string, string | string[]> = {
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
  // web 前端错误上报（批 B7）：复用 agent:handle——本 action 不读写任何业务数据，只写自己的诊断遥测（anomalies），
  // 不为它单开新 cap；外包坐席台前端也要能报错（否则 agent 端报错永远 403）；同 searchConversations 复用
  // customer:view 的先例（不为单 action 开新 cap）。
  reportClientError: 'agent:handle',
  // 越规退款（决策§26·退货管理权限）：单立 refund:manage 能力——超管 '*' 天然匹配，未来可给中间角色单授而不放全量 admin:write
  overrideRefund: 'refund:manage',
  // 补录实际到账金额（支付异常单退款死胡同出口·退款链路前置）：与 overrideRefund 同权——它直接决定退款金额分母，
  // 属退款管理面，不放全量 admin:write；仅 payment_exception 态可补（不篡改正常单实付）。
  recordPaidFee: 'refund:manage',
  // refund:manage 最小只读面（待办与债 2026-07-12 批 B8 评审发现节·C4 落地）：overrideRefund 依赖的退款
  // 工作台加载面（列表/计数/详情/订单联查）此前未登记 ACTION_CAPS→默认落 admin:write，给中间角色单授
  // refund:manage 时页面加载即 403。登记为「任一命中」数组：admin:write 持有者行为完全不变（防收紧误伤），
  // refund:manage 独立可用（债目意图）。
  listRefunds: ['admin:write', 'refund:manage'],
  refundCounts: ['admin:write', 'refund:manage'],
  getRefundDetail: ['admin:write', 'refund:manage'],
  // listOrders 对 refund:manage 是「核对退款这一单」的联查口，非全店浏览面：能力闸只按 action 名放行、
  // 看不到 data 里有没有过滤——放开后 refund:manage-only 可不带 q 翻遍全店客户 PII（P2 评审收窄）。故
  // listOrders handler 内再对「仅持 refund:manage」的调用方强制精确单号 q（admin:write/'*' 全店浏览不变）。
  listOrders: ['admin:write', 'refund:manage'],
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
  // 缺 IP 与全局信号共用 GLOBAL_KEY——调用方必须当「无独立源」，不得当 per-IP 硬预拒/双计/成功清全局。
  return ip ? 'adminlogin:' + ip : GLOBAL_KEY
}

// per-IP 是合法单源限速·硬预拒；全局闸只作分布式爆破的**信号**、不硬预拒（收尾硬化批 2026-07-13·用户拍板）：
// 旧实现取 max(ip, global) 预拒——攻击者用轮换 x-forwarded-for 的错误口令把全局计数打到阈，会把持正确口令的
// 真超管一并锁死门外 5min（发货/退款/客服全停）。改为：全局锁定不预拒，仍进 checkKey，口令对即放行；口令错才计数
// + 告警（GLOBAL_BRUTE·人工感知分布式爆破）——攻击者拿不到口令，锁不住真超管，per-IP 硬闸仍挡住单源爆破。
async function throttleGate(tkey: string): Promise<{ ipWait: number; globalWait: number }> {
  const [ipWait, globalWait] = await Promise.all([throttleLocked(tkey), throttleLocked(GLOBAL_KEY)])
  return { ipWait, globalWait }
}
// 鉴权失败计数 + 分布式爆破信号（login / 企微免登 / 泛 action 三个入口共用）。全局已锁时每次失败留一行日志；
// 进来时未锁、计完已锁才 notifyAlert 进 anomalies 并推企微。上锁那一刻并发在跑的失败请求都满足这个条件，
// 所以推送前还要抢 claimBrutePush——一轮爆破只推一次，不把企微机器人（每分钟 20 条）刷到限流、挤掉钱链告警。
async function authFail(tkey: string, globalWait: number): Promise<void> {
  if (tkey !== GLOBAL_KEY) await throttleFail(tkey, ADMIN_THROTTLE)
  await throttleFail(GLOBAL_KEY, ADMIN_THROTTLE_GLOBAL)
  if (globalWait === 0 && (await throttleLocked(GLOBAL_KEY)) === 0) return
  if (globalWait === 0 && (await claimBrutePush())) await notifyAlert('security', 'adminLogin', 'GLOBAL_BRUTE', {})
  else alert('security', 'adminLogin', 'GLOBAL_BRUTE', {})
}
// 推送权：同一文档的条件更新在库里串行执行，lockMs 内只有一个请求能把 pushedAt 改成功；首轮还没档时靠 add 撞 _id 定胜负。
// ponytail: 抢权读写失败就不推（anomalies/日志仍在），按「宁少推不刷屏」取舍；要保底送达得区分撞号与库故障。
const BRUTE_PUSH_ID = 'adminlogin-brute-push'
async function claimBrutePush(): Promise<boolean> {
  const now = Date.now()
  const coll = db.collection(COLLECTIONS.rateLimit)
  const r = await coll
    .where({ _id: BRUTE_PUSH_ID, pushedAt: db.command.lt(now - ADMIN_THROTTLE_GLOBAL.lockMs) })
    .update({ data: { pushedAt: now, updatedAt: now } })
    .catch(() => null)
  if (r && r.stats && r.stats.updated === 1) return true
  return coll.add({ data: { _id: BRUTE_PUSH_ID, pushedAt: now, updatedAt: now } }).then(
    () => true,
    () => false
  )
}

// 审计成功判定（C3·根因#14 失败不可观测）：handler 一律经 reply() 返回 { statusCode, body:JSON字符串 }。
// 仅看 statusCode===200 会把 ops.ts/wxbill.ts 等「HTTP 200 + body.ok:false」的业务失败误记成成功。改判：
// statusCode===200 且解析 body 后 ok 不为 false 才算成功（body 无 ok 字段＝按成功·保留旧宽松语义；
// body 非 JSON＝不该发生，保守按 200 记成功、与旧行为一致，绝不因判定本身反噬审计）。
function auditOk(res: any): boolean {
  if (!res || res.statusCode !== 200) return false
  try {
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body
    return !body || body.ok !== false
  } catch {
    return true
  }
}

// 口令登录：失败计爆破，成功只清独立 IP 的计数并签发会话令牌。
async function loginByPassword(key: unknown, tkey: string, globalWait: number) {
  const res = await checkKey(db, key, true)
  if (!res.ok) {
    // 库故障≠错口令：不计爆破不告警；回 503 而非 401，前端不清令牌
    if (res.error === 'AUTH_UNAVAILABLE') return reply(503, res)
    await authFail(tkey, globalWait)
    return reply(401, res)
  }
  if (tkey !== GLOBAL_KEY) await throttleReset(tkey) // 成功只清独立 IP；缺 IP/全局靠窗口衰减（防爆破信号被一次成功登入抹掉）
  // 签发会话令牌（口令不落盘）：前端此后只存/只发令牌；签发失败如实返空、前端 fail-closed 拒登
  const docId = res.agentId === 'admin' ? 'auth' : String(res.agentId || 'auth')
  const sessionToken = await issueSession(db, docId, 'pwd').catch((e) => {
    alert('security', 'adminLogin', 'SESSION_ISSUE_FAIL', { via: 'pwd', docId, err: String(e) })
    return ''
  })
  return reply(200, { ...res, sessionToken })
}

// 企微 OAuth 免登：按返回码分类计频控（C2·防基建冷窗自我 DoS）：wecomLogin.ts 枚举——200=成功；401 BAD_CODE /
// 403 NO_BOUND_ACCOUNT / 403 ACCOUNT_DISABLED=真鉴权失败（爆破证据）→ 计 throttleFail；
// 503 KF_TOKEN_UNAVAILABLE（令牌缓存冷窗·非爆破）/ 400 BAD_ARGS（缺 code·客户端错）=既不计失败也不 reset，
// 否则办公室固定 IP 会在令牌冷窗期被无辜锁死。GLOBAL_BRUTE 告警跟随计数（authFail）：只有真鉴权失败才可能告警。
async function loginByWecom(data: any, tkey: string, globalWait: number) {
  const res = await wecomLogin.loginByWecomCode({ db, data })
  if (res.statusCode === 200 && tkey !== GLOBAL_KEY) await throttleReset(tkey)
  else if (res.statusCode === 401 || res.statusCode === 403) await authFail(tkey, globalWait)
  // 503/400 等基建/客户端错：直接返回，不触碰频控（不计不 reset·不告警）
  return res
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

  // 认证频控闸：口令校验前先查锁定。per-IP 到阈硬预拒；全局锁定**不**预拒（防轮换 IP 错误口令自我 DoS 锁死真超管），
  // 仅作信号——见 throttleGate 注释。
  const tkey = clientKey(event)
  const { ipWait, globalWait } = await throttleGate(tkey)
  // 只有独立 IP 的 per-IP 锁才硬预拒。缺 IP 时 tkey===GLOBAL_KEY，ipWait 其实是全局信号——预拒会把真超管锁门外。
  if (ipWait > 0 && tkey !== GLOBAL_KEY) return reply(429, { ok: false, error: 'TOO_MANY_ATTEMPTS', retryAfter: Math.ceil(ipWait / 1000) })

  if (action === 'login') return loginByPassword(key, tkey, globalWait)

  // 登出（pre-auth·在能力闸前）：外包只有 agent:handle，走默认拒会 403 登不出。拿着令牌就能吊销它自己，
  // 无效令牌也回成功，回包不当令牌有效性探针，故不计爆破失败。
  if (action === 'logout') {
    if (!(await revokeSession(db, String(key || '')))) return reply(503, { ok: false, error: 'AUTH_UNAVAILABLE' })
    return reply(200, { ok: true })
  }

  // 企微 OAuth 免登（pre-auth·坐席无口令·同 login 受频控防刷 code）：换 userid→查绑定账号→签发 session 令牌
  if (action === 'loginByWecomCode') return loginByWecom(data, tkey, globalWait)

  // 其余 action 一律先验口令/令牌（同受频控，防经任一 action 入口爆破）
  const auth = await checkKey(db, key, false)
  if (!auth.ok) {
    if (auth.error === 'AUTH_UNAVAILABLE') return reply(503, auth)
    await authFail(tkey, globalWait) // 泛 action 与 login 打的是同一把口令、同一类爆破，同 tag 'adminLogin' 聚合
    return reply(401, auth)
  }
  if (tkey !== GLOBAL_KEY) await throttleReset(tkey)
  // 能力闸·默认拒：登记的取 ACTION_CAPS、未登记默认高权 ADMIN_DEFAULT_CAP；超管 '*' 匹配一切。
  // 「任一命中」语义（C4）：ACTION_CAPS 值可为单 cap 或 cap 数组——principal 持数组中任一 cap 即放行，
  // admin:write 与 refund:manage 并列登记时，admin:write 持有者行为不变、refund:manage 独立可用。
  const caps: string[] = Array.isArray(auth.caps) ? auth.caps : []
  const capSpec = ACTION_CAPS[action]
  const needCaps: string[] = Array.isArray(capSpec) ? capSpec : capSpec ? [capSpec] : [ADMIN_DEFAULT_CAP]
  if (!caps.some((c) => c === '*' || needCaps.includes(c))) return reply(403, { ok: false, error: 'FORBIDDEN' })
  const drafts = db.collection('productsDraft')

  const handler = ACTIONS[action]
  if (!handler) return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  const auditIp = tkey.replace('adminlogin:', '')
  const operator = String(auth.operator || 'admin') // 真实操作者身份·多账号可追溯
  const agentId = String(auth.agentId || operator)
  let res: any
  let crash: { module?: string; error?: string } = {} // 只有异常路径带模块归因
  try {
    res = await handler({ db, cloud, data, drafts, agentId, caps })
  } catch (e) {
    console.error('adminApi error', action, e)
    crash = { module: ADMIN_ACTION_MODULE_BY_NAME[action] ?? 'unknown', error: 'SERVER_ERROR' }
    res = reply(500, { ok: false, error: 'SERVER_ERROR' })
  }
  if (shouldAudit(action)) await recordAudit({ action, operator, ip: auditIp, data, ok: auditOk(res), ...crash })
  return res
}

/** 测试挂载口（ACTIONS/ACTION_CAPS 已全域挂载·与旧线注册表逐行核对过）。 */
export const registries = { ACTIONS, ACTION_CAPS, ADMIN_ACTION_MODULE_BY_NAME }
