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
} as const

export type CollName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]
