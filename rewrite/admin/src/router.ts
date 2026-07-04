// 路由（hash·静态托管友好）。信息架构按运营动作重组（M3 重写·非旧侧栏平铺）：
// 总览 / 商品与内容 / 订单与钱 / 客服 / 进销存 / 系统 六组——页面随批次逐组填充。
import { createRouter, createWebHashHistory } from 'vue-router'
import { client } from './api'

const Login = () => import('./pages/Login.vue')
const Shell = () => import('./shell/Shell.vue')
const Dashboard = () => import('./pages/Dashboard.vue')
const Orders = () => import('./pages/Orders.vue')
const Refunds = () => import('./pages/Refunds.vue')
const Products = () => import('./pages/Products.vue')
const Showcase = () => import('./pages/Showcase.vue')
const HomeContent = () => import('./pages/HomeContent.vue')
const HelpVideos = () => import('./pages/HelpVideos.vue')
const Courses = () => import('./pages/Courses.vue')
const Conversations = () => import('./pages/Conversations.vue')
const Customer360 = () => import('./pages/Customer360.vue')
const Kb = () => import('./pages/Kb.vue')
const Csat = () => import('./pages/Csat.vue')
const Checkpoints = () => import('./pages/Checkpoints.vue')

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login },
    {
      path: '/',
      component: Shell,
      children: [
        { path: '', component: Dashboard },
        { path: 'orders', component: Orders },
        { path: 'refunds', component: Refunds },
        { path: 'products', component: Products },
        { path: 'showcase', component: Showcase },
        { path: 'home-content', component: HomeContent },
        { path: 'help-videos', component: HelpVideos },
        { path: 'courses', component: Courses },
        { path: 'conversations', component: Conversations },
        { path: 'customer360', component: Customer360 },
        { path: 'kb', component: Kb },
        { path: 'csat', component: Csat },
        { path: 'checkpoints', component: Checkpoints },
      ],
    },
  ],
})

// 会话闸：无令牌一律回登录页（fail-closed·令牌真伪由云端裁决）
router.beforeEach((to) => {
  if (to.path !== '/login' && !client.hasSession()) return '/login'
  if (to.path === '/login' && client.hasSession()) return '/'
  return true
})
