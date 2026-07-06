// 控制台导航模型（守卫 rw-admin-nav-contextual·根因#8「构建过≠真机能用」）：上下文侧栏——顶层用 Shell
// 六组运营 nav，进上新向导路由（/products/:id/wizard）切成「按步直达」聚焦步导航（设计 console.pen
// Component/Sidebar kz2uD 单源·决策§27②）。步文案/顺序/图标抄录设计帧、URL ?step 为步单源，侧栏与
// Wizard 顶部横向 rail 同读它。纯数据+纯函数收口在此，Shell 只消费——便于 nav.test 焊死不靠组件挂载。

/** 向导路由：/products/:id/wizard（带参·rw-admin-nav-route-synced 已豁免孤儿检查·单段 id） */
export function isWizardPath(path: string): boolean {
  return /^\/products\/[^/]+\/wizard$/.test(path)
}

/** ?step=N 夹到 1..6，非法/缺省回 1（列表深链落到首个未完成步·Products.vue firstTodoStep） */
export function wizardStepFromQuery(step: unknown): number {
  const n = Number.parseInt(String(step ?? ''), 10)
  return Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : 1
}

/** 上新向导 6 步（文案/顺序/图标抄录设计 kz2uD·NavImg…NavBatch·icon 为 lucide 名，Shell 侧映射组件） */
export interface WizardStep {
  n: number
  label: string
  icon: string
}
export const WIZARD_STEPS: WizardStep[] = [
  { n: 1, label: '产品图片', icon: 'image' },
  { n: 2, label: '商品信息', icon: 'file-text' },
  { n: 3, label: '商品 SKU', icon: 'tags' },
  { n: 4, label: '视频上传', icon: 'clapperboard' },
  { n: 5, label: '二维码卡片', icon: 'qr-code' },
  { n: 6, label: '码批次与印刷包', icon: 'printer' },
]
