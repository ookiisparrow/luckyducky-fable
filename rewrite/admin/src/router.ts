// 路由（hash·静态托管友好）。信息架构按运营动作重组（M3 重写·非旧侧栏平铺）：
// 总览 / 商品与内容 / 订单与钱 / 客服 / 进销存 / 系统 六组——页面随批次逐组填充。
import { createRouter, createWebHashHistory } from 'vue-router'
import { client } from './api'

const Login = () => import('./pages/Login.vue')
const Shell = () => import('./shell/Shell.vue')
const Dashboard = () => import('./pages/Dashboard.vue')
const Orders = () => import('./pages/Orders.vue')
const Fulfill = () => import('./pages/Fulfill.vue')
const Refunds = () => import('./pages/Refunds.vue')
const Products = () => import('./pages/Products.vue')
const Showcase = () => import('./pages/Showcase.vue')
const HomeContent = () => import('./pages/HomeContent.vue')
const HelpVideos = () => import('./pages/HelpVideos.vue')
const Courses = () => import('./pages/Courses.vue')
const Cards = () => import('./pages/Cards.vue')
const ScmMaterials = () => import('./pages/ScmMaterials.vue')
const ScmPurchase = () => import('./pages/ScmPurchase.vue')
const ScmOutwork = () => import('./pages/ScmOutwork.vue')
const ScmBom = () => import('./pages/ScmBom.vue')
const ScmPlanner = () => import('./pages/ScmPlanner.vue')
const Agents = () => import('./pages/Agents.vue')
const Batches = () => import('./pages/Batches.vue')
const Settings = () => import('./pages/Settings.vue')
const Reconciliation = () => import('./pages/Reconciliation.vue')
const Inventory = () => import('./pages/Inventory.vue')
const External = () => import('./pages/External.vue')
const Conversations = () => import('./pages/Conversations.vue')
const Customer360 = () => import('./pages/Customer360.vue')
const Kb = () => import('./pages/Kb.vue')
const Csat = () => import('./pages/Csat.vue')
const Checkpoints = () => import('./pages/Checkpoints.vue')
const Inspect = () => import('./pages/Inspect.vue')
const Anomalies = () => import('./pages/Anomalies.vue')

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
        { path: 'fulfill', component: Fulfill },
        { path: 'refunds', component: Refunds },
        { path: 'products', component: Products },
        { path: 'showcase', component: Showcase },
        { path: 'home-content', component: HomeContent },
        { path: 'help-videos', component: HelpVideos },
        { path: 'courses', component: Courses },
        { path: 'cards', component: Cards },
        { path: 'conversations', component: Conversations },
        { path: 'customer360', component: Customer360 },
        { path: 'kb', component: Kb },
        { path: 'csat', component: Csat },
        { path: 'checkpoints', component: Checkpoints },
        { path: 'scm-materials', component: ScmMaterials },
        { path: 'scm-purchase', component: ScmPurchase },
        { path: 'scm-outwork', component: ScmOutwork },
        { path: 'scm-bom', component: ScmBom },
        { path: 'scm-planner', component: ScmPlanner },
        { path: 'agents', component: Agents },
        { path: 'batches', component: Batches },
        { path: 'settings', component: Settings },
        { path: 'reconciliation', component: Reconciliation },
        { path: 'inventory', component: Inventory },
        { path: 'external', component: External },
        { path: 'inspect', component: Inspect },
        { path: 'anomalies', component: Anomalies },
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
