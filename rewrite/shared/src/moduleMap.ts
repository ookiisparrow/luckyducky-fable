/**
 * app action → 业务模块映射（车队地基批2·异常归因）。单源＝仓根 modules.json（模块正册），
 * 云函数运行时物理进不了 JSON 单源，故设此镜像——守卫 module-map-synced 与正册逐键焊死，改正册漏改此表即红。
 * 消费者：app/index.ts 顶层兜底把 module 写进 anomalies 账本 ctx（admin Anomalies 页按模块看「今天谁在冒错」）。
 */
export const APP_ACTION_MODULE: Record<string, string> = {
  login: 'identity',
  updateProfile: 'identity',
  getProducts: 'shop',
  getProductDetail: 'shop',
  getContent: 'shop',
  getPageContent: 'shop',
  getHelpVideos: 'shop',
  activateCourse: 'learning',
  confirmEnter: 'learning',
  getCourses: 'learning',
  getPlaybackUrl: 'learning',
  getMyCourses: 'learning',
  getMyProgress: 'learning',
  trackEvent: 'learning',
  getReviews: 'reviews',
  getRatingSummary: 'reviews',
  submitReview: 'reviews',
  createOrder: 'orders',
  pay: 'orders',
  applyRefund: 'orders',
  confirmReceive: 'orders',
  cancelOrder: 'orders',
  getMyOrders: 'orders',
  getOrderById: 'orders',
  getMyAfterSales: 'orders',
  kfBind: 'cs',
  dataConsent: 'cs',
  submitFeedback: 'cs',
  submitCheckpointPhoto: 'cs',
  getPublicFaq: 'cs',
}

/** 查 action 所属模块；未登记（理论上被 module-registry-complete 挡住）回 'unknown' 不抛。 */
export const moduleOfAction = (action: string): string => APP_ACTION_MODULE[action] ?? 'unknown'
