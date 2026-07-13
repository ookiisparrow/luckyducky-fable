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
  inspectRuns: 'inspectRuns', // 巡检机体检报告（每次运行 A/B 检查红绿灯·仅管理端·runInspection 单口写入）
  // 敏感凭证入库单源（2026-07-12 决策·config-checklist 本页填写自动生效）：doc('wxkf')/doc('wxpay')，
  // 云函数运行时读库优先、env 兜底迁移期——见 kit/secureConfig.ts。仅 saveSecureConfig 单口写入。
  secureConfig: 'secureConfig',
  // createOrder 幂等键（批E·P1 防网络超时重试双建单）：_id=(openid+客户端幂等键) 确定性哈希，
  // 存 { openid, orderId, createdAt }；建单前 claim、建单后回填 orderId——见 orders.ts createOrder。
  orderIdempotency: 'orderIdempotency',
} as const
