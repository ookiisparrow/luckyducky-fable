// 集合名单一来源（债#28·安全）。
//
// 库权限按集合逐一锁「仅管理端」（16 集合 + 草稿/限频，见 console-assets/02-库权限期望表）。
// 风险：`.collection('aftersales')` 打错字 → 静默建/查一个**不在锁名单内**的新集合 ＝ 无权限保护的洞。
// 治法：所有云函数用到的集合名在此登记为权威册；守卫 known-collections-only 校验全库任何
// `.collection()/createCollection/ensure` 的字面量名都在此册内——打错即红，新集合须先登记（并去控制台锁权限）。
//
// 用法：可直接 `db.collection(COLLECTIONS.orders)`（新代码建议）；旧的裸字面量只要名字在册即放行。
export const COLLECTIONS = {
  users: 'users',
  orders: 'orders',
  afterSales: 'afterSales',
  products: 'products',
  productsDraft: 'productsDraft',
  courses: 'courses',
  coursesDraft: 'coursesDraft',
  activations: 'activations',
  qrcodes: 'qrcodes',
  progress: 'progress',
  reviews: 'reviews',
  content: 'content',
  config: 'config',
  adminConfig: 'adminConfig',
  cards: 'cards',
  uploadChunks: 'uploadChunks',
  events: 'events',
  rateLimit: 'rateLimit',
  // 实物 SKU 库存（库存#1·下单即预留·乐观 CAS）：_id 为 productId__spec，字段 stock（null=不限量）/threshold。
  // 仅 kit/inventory 读写（守卫 stock-atomic-conditional）；客户端禁读写，上线前控制台锁「仅管理端」。
  inventory: 'inventory',
  // 操作审计（操作审计#4）：管理端动钱/状态操作留痕（action/operator/summary/ok/ts·凭证已剥）。
  // 仅 kit/audit 写、adminApi 分发处调；客户端禁读写，上线前控制台锁仅管理端。
  auditLog: 'auditLog',
  // 微信客服（in-chat 智能客服）后端状态：access_token 缓存 / sync_msg cursor / msgid 去重痕，
  // 一律确定性 _id 前缀（token / cursor:<openKfId> / seen:<msgid>）。内部状态、客户端禁读写。
  kfState: 'kfState',
  // 身份桥接映射（external_userid ↔ openid，根因#3 不信前端）：_id='ext:euid' 存 openid。
  // 由小程序侧 kfBind（withOpenId·有 unionid 时）经企业微信转换 API 建；kfCallback 读它查「你的订单」。
  kfIdentity: 'kfIdentity',
  // 用户意见反馈（运营钩子①·待办#23）：submitFeedback（withOpenId+withRateLimit）写入，
  // 内部状态、仅管理端可读（控制台锁权限）；客户端只写不读。字段 category/content/contact/page/version/platform。
  feedback: 'feedback',
  // 微信支付交易账单缓存（S16 外部对账 Batch 2）：downloadBill 拉的微信权威账单逐笔落此，确定性
  // _id=`<date>:<transactionId>`（幂等·重拉覆盖）；供逐笔对账（Batch 3）比对我方 orders/afterSales。
  // 仅 adminApi.downloadBill 写（经 kit/wxpay）；客户端禁读写，上线前控制台锁「仅管理端」。
  wxBills: 'wxBills',
  // 节点诊断（后台360工作站 B2.2·节点诊断 MVP）：一集合两形状（确定性 _id 前缀区分·同 kfState 范式）——
  // `def:<courseId>:<nodeId>` 关键节点定义（admin 策展：title/remedy 挽回办法·order）；`sub:<openid>:<courseId>:<nodeId>`
  // 用户拍照提交（submitCheckpointPhoto·imgSecCheck 过后才入库·幂等重传覆盖最新）。仅云函数读写、客户端禁，上线前控制台锁「仅管理端」。
  checkpoints: 'checkpoints',
  // 知识库（后台360工作站 B4.1·FAQ/知识条目单源·根因#5 复制即漂移）：确定性 _id=FAQ 键（如 `logistics:eta`·
  // 同客服分流菜单叶子 id）；字段 question/answer/category/enabled/order。admin 经 adminApi listKb/saveKb 维护（整体覆盖式），
  // 客服 bot dispatch 读它发 FAQ 答案（替代原写死 TEXT_ANSWERS·守卫 faq-via-kb-single-source）。仅云函数读写、客户端禁，上线前控制台锁「仅管理端」。
  kb: 'kb',
} as const

export type CollName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]
