// 进销存 SCM 页面顺序单源（旧线 utils/scmFlow.js 移植·用户 2026-07-02「按工作流程顺序排序+顶部切换标签」拍板）。
// 新线 5 页版：建档(物料/配方) → 算缺口/统计(备货产销) → 补料(采购/外协)。ScmFlowTabs.vue 消费本表；
// Shell 侧栏「供应链」组用同一批 path（golden rw-admin-scm-ui-golden 焊死：SCM_FLOW path 集合 === Shell SCM 组；
// Shell↔router 另由 rw-admin-nav-route-synced 兜 ⇒ 传递性保证 ⊆ router·防死链/防漂移）。
// 新增/调整 SCM 页面只改这一处 + Shell 对应组 + router。
import { Warehouse, Blocks, CalendarRange, ClipboardList, Handshake } from 'lucide-vue-next'
import type { Component } from 'vue'

export interface ScmFlowStep {
  to: string
  label: string
  icon: Component
}

export const SCM_FLOW: ScmFlowStep[] = [
  { to: '/scm-materials', label: '物料与供应商', icon: Warehouse },
  { to: '/scm-bom', label: '配方与组装', icon: Blocks },
  { to: '/scm-planner', label: '备货与产销', icon: CalendarRange },
  { to: '/scm-purchase', label: '采购单', icon: ClipboardList },
  { to: '/scm-outwork', label: '外协单', icon: Handshake },
]
