import { createRouter, createWebHashHistory } from 'vue-router'
import { isLoggedIn } from '@/api/cloud.js'
import Login from '@/pages/Login.vue'
import ProductList from '@/pages/ProductList.vue'
import Wizard from '@/pages/Wizard.vue'
import Showcase from '@/pages/Showcase.vue'
import HelpVideos from '@/pages/HelpVideos.vue'
import Orders from '@/pages/Orders.vue'
import Refunds from '@/pages/Refunds.vue'
import Dashboard from '@/pages/Dashboard.vue'
import Reconciliation from '@/pages/Reconciliation.vue'
import Inventory from '@/pages/Inventory.vue'
import Notifications from '@/pages/Notifications.vue'
import Externals from '@/pages/Externals.vue'
import Customer360 from '@/pages/Customer360.vue'
import Checkpoints from '@/pages/Checkpoints.vue'
import Conversations from '@/pages/Conversations.vue'
import Kb from '@/pages/Kb.vue'
import Csat from '@/pages/Csat.vue'
import Agents from '@/pages/Agents.vue'
import ScmMaterials from '@/pages/ScmMaterials.vue'
import ScmBom from '@/pages/ScmBom.vue'
import ScmPlanner from '@/pages/ScmPlanner.vue'
import ScmPurchase from '@/pages/ScmPurchase.vue'
import ScmOutwork from '@/pages/ScmOutwork.vue'
import ScmAssembly from '@/pages/ScmAssembly.vue'
import ScmSummary from '@/pages/ScmSummary.vue'
import Fulfill from '@/pages/Fulfill.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/', redirect: '/products' },
    { path: '/products', component: ProductList },
    { path: '/showcase', component: Showcase },
    { path: '/help-videos', component: HelpVideos },
    { path: '/orders', component: Orders },
    { path: '/refunds', component: Refunds },
    { path: '/customer360', component: Customer360 },
    { path: '/conversations', component: Conversations },
    { path: '/inventory', component: Inventory },
    { path: '/checkpoints', component: Checkpoints },
    { path: '/kb', component: Kb },
    { path: '/dashboard', component: Dashboard },
    { path: '/csat', component: Csat },
    { path: '/reconciliation', component: Reconciliation },
    { path: '/notifications', component: Notifications },
    { path: '/externals', component: Externals },
    { path: '/agents', component: Agents },
    // 进销存 SCM（按使用流程排序：建档 → 算缺口 → 补料 → 产出 → 统计·同 Sidebar/ScmFlowTabs 顺序）
    { path: '/scm-materials', component: ScmMaterials },
    { path: '/scm-bom', component: ScmBom },
    { path: '/scm-planner', component: ScmPlanner },
    { path: '/scm-purchase', component: ScmPurchase },
    { path: '/scm-outwork', component: ScmOutwork },
    { path: '/scm-assembly', component: ScmAssembly },
    { path: '/scm-summary', component: ScmSummary },
    // 上新向导：/product/<id>/step/<1-6>；左侧「按步骤直达」也跳这里
    { path: '/product/:id/step/:n', component: Wizard, props: true },
    // 发货工作台（R32·主流程同上新形态）：/fulfill/step/<1-3> 拣货备货→打印标签→扫码发货
    { path: '/fulfill/step/:n', component: Fulfill, props: true },
  ],
})

router.beforeEach((to) => {
  if (to.path !== '/login' && !isLoggedIn()) return '/login'
  if (to.path === '/login' && isLoggedIn()) return '/products'
  return true
})
