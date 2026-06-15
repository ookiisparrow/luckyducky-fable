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
} as const

export type CollName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]
