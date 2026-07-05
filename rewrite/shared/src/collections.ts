/**
 * 集合名册（设计约束「集合单一来源」·镜像旧线 kit/collections.ts——同一个生产库、37 集合原地复用，
 * 名字是数据契约不可改）。并存期 parity 测试焊死与旧线逐键一致；新集合先登记（并去控制台锁权限）再用。
 */
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
  inventory: 'inventory',
  auditLog: 'auditLog',
  kfState: 'kfState',
  kfIdentity: 'kfIdentity',
  feedback: 'feedback',
  wxBills: 'wxBills',
  checkpoints: 'checkpoints',
  conversations: 'conversations',
  kb: 'kb',
  csat: 'csat',
  csSession: 'csSession',
  agentState: 'agentState',
  materials: 'materials',
  suppliers: 'suppliers',
  purchaseOrders: 'purchaseOrders',
  outworkOrders: 'outworkOrders',
  assemblyOrders: 'assemblyOrders',
  stockLedger: 'stockLedger',
  bomProfiles: 'bomProfiles',
  // —— 新线新增（观测·旧线无·走 parity 显式登记名单）——
  anomalies: 'anomalies', // bug 收集器账本（防治静默 bug·指纹去重·仅管理端·recordAnomaly 单口写入）
} as const

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]
