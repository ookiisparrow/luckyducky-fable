// 控制台导航模型（守卫 rw-admin-nav-contextual·根因#8「构建过≠真机能用」）：上下文侧栏——顶层用 Shell
// 六组运营 nav，进上新向导路由（/products/:id/wizard）切成「按步直达」聚焦步导航（设计 console.pen
// Component/Sidebar kz2uD 单源·决策§27②）。步文案/顺序抄录设计帧、URL ?step 为步单源，侧栏与
// Wizard 顶部横向 rail 同读它。纯数据+纯函数收口在此，Shell 只消费——便于 nav.test 焊死不靠组件挂载。

/** 向导路由：/launch（新建）或 /products/:id/wizard（续做·带参·rw-admin-nav-route-synced 已豁免孤儿检查） */
export function isWizardPath(path: string): boolean {
  return path === '/launch' || /^\/products\/[^/]+\/wizard$/.test(path)
}

/** 上新向导步数（侧栏/进度圆点/URL ?step 同读） */
export const WIZARD_STEP_MAX = 5

/** ?step=N 夹到 1..5；旧 step=6 深链落到新第 5 步；非法/缺省回 1（列表深链落到首个未完成步） */
export function wizardStepFromQuery(step: unknown): number {
  const n = Number.parseInt(String(step ?? ''), 10)
  if (!Number.isFinite(n) || n < 1) return 1
  if (n >= 6) return WIZARD_STEP_MAX
  return Math.min(WIZARD_STEP_MAX, n)
}

/** 当前路由命中的可展开组名（solo 项/未命中回 ''）——供 Shell 判「当前组自动展开」+ 组头点击不做「翻转
 * localStorage」的死操作（守卫 rw-admin-nav-contextual·根因#8）：当前组本就 route 命中恒开，若组头 toggle 仍
 * 写 expanded 会把它悄悄塞进持久展开集（下次点才移·可见态从不变·且离页后该组一直展开）——本函数定位当前组，
 * Shell 据此让当前组的组头点击成干净 no-op（不污染 localStorage、不反转意图）。 */
export function currentNavGroup(
  nav: Array<{ group: string; solo?: boolean; items: Array<{ path: string }> }>,
  path: string
): string {
  for (const n of nav) {
    if (n.solo) continue
    if (n.items.some((it) => it.path === path)) return n.group
  }
  return ''
}

/** 上新向导 5 步（封面并进第 1 步、卡片上传并进第 5 步·不要「设计」） */
export interface WizardStep {
  n: number
  label: string
  hint: string
}
export const WIZARD_STEPS: WizardStep[] = [
  { n: 1, label: '新建与封面', hint: '创建草稿并上传封面图' },
  { n: 2, label: '图片与名字', hint: '商品图集与标题文案' },
  { n: 3, label: '详情信息', hint: '规格、价格与详情页' },
  { n: 4, label: '课程视频', hint: '上传并发布教学视频' },
  { n: 5, label: '卡片与二维码', hint: '卡面素材与批次二维码' },
]
