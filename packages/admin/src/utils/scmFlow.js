import { Package, LayoutTemplate, Calculator, ShoppingCart, Scissors, PackageOpen, BarChart3 } from 'lucide-vue-next'

// 进销存 SCM 页面顺序单源（用户 2026-07-02「按工作流程顺序排序」拍板）：建档(物料/配方) → 算缺口(备货)
// → 补料(采购/外协) → 产出(打包) → 统计(产销)。Sidebar 导航组 与 顶部流程标签（components/ScmFlowTabs.vue）
// 共用本表，别在两处分别改顺序（防漂移）——新增/调整 SCM 页面只改这一处。
export const SCM_FLOW = [
  { to: '/scm-materials', label: '物料与供应商', icon: Package },
  { to: '/scm-bom', label: '配方模板', icon: LayoutTemplate },
  { to: '/scm-planner', label: '备货计算', icon: Calculator },
  { to: '/scm-purchase', label: '采购管理', icon: ShoppingCart },
  { to: '/scm-outwork', label: '外协加工', icon: Scissors },
  { to: '/scm-assembly', label: '打包组装', icon: PackageOpen },
  { to: '/scm-summary', label: '产销统计', icon: BarChart3 },
]
