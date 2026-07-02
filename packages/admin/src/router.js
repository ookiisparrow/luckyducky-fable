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
import ScmPurchase from '@/pages/ScmPurchase.vue'
import ScmOutwork from '@/pages/ScmOutwork.vue'
import ScmBom from '@/pages/ScmBom.vue'
import ScmAssembly from '@/pages/ScmAssembly.vue'

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
    { path: '/scm-materials', component: ScmMaterials },
    { path: '/scm-purchase', component: ScmPurchase },
    { path: '/scm-outwork', component: ScmOutwork },
    { path: '/scm-bom', component: ScmBom },
    { path: '/scm-assembly', component: ScmAssembly },
    // 上新向导：/product/<id>/step/<1-6>；左侧「按步骤直达」也跳这里
    { path: '/product/:id/step/:n', component: Wizard, props: true },
  ],
})

router.beforeEach((to) => {
  if (to.path !== '/login' && !isLoggedIn()) return '/login'
  if (to.path === '/login' && isLoggedIn()) return '/products'
  return true
})
