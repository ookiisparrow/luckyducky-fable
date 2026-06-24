import { createRouter, createWebHashHistory } from 'vue-router'
import { isLoggedIn } from '@/api/cloud.js'
import Login from '@/pages/Login.vue'
import ProductList from '@/pages/ProductList.vue'
import Wizard from '@/pages/Wizard.vue'
import Showcase from '@/pages/Showcase.vue'
import Orders from '@/pages/Orders.vue'
import Refunds from '@/pages/Refunds.vue'
import Dashboard from '@/pages/Dashboard.vue'
import Inventory from '@/pages/Inventory.vue'
import Notifications from '@/pages/Notifications.vue'
import Externals from '@/pages/Externals.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/', redirect: '/products' },
    { path: '/products', component: ProductList },
    { path: '/showcase', component: Showcase },
    { path: '/orders', component: Orders },
    { path: '/refunds', component: Refunds },
    { path: '/inventory', component: Inventory },
    { path: '/dashboard', component: Dashboard },
    { path: '/notifications', component: Notifications },
    { path: '/externals', component: Externals },
    // 上新向导：/product/<id>/step/<1-6>；左侧「按步骤直达」也跳这里
    { path: '/product/:id/step/:n', component: Wizard, props: true },
  ],
})

router.beforeEach((to) => {
  if (to.path !== '/login' && !isLoggedIn()) return '/login'
  if (to.path === '/login' && isLoggedIn()) return '/products'
  return true
})
