// 路由（hash·静态托管友好）。信息架构按运营动作重组（M3 重写·非旧侧栏平铺）：
// 总览 / 商品与内容 / 订单与钱 / 客服 / 进销存 / 系统 六组——页面随批次逐组填充。
import { createRouter, createWebHashHistory } from 'vue-router'
import { client } from './api'
import { isUploadLocked } from './lib/uploadLock'

const Login = () => import('./pages/Login.vue')
const Shell = () => import('./shell/Shell.vue')
const Dashboard = () => import('./pages/Dashboard.vue')
const Orders = () => import('./pages/Orders.vue')
const Fulfill = () => import('./pages/Fulfill.vue')
const Refunds = () => import('./pages/Refunds.vue')
const Products = () => import('./pages/Products.vue')
const Wizard = () => import('./pages/Wizard.vue')
const Showcase = () => import('./pages/Showcase.vue')
const HomeContent = () => import('./pages/HomeContent.vue')
const HelpVideos = () => import('./pages/HelpVideos.vue')
const Courses = () => import('./pages/Courses.vue')
const Cards = () => import('./pages/Cards.vue')
const ScmOverview = () => import('./pages/ScmOverview.vue')
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
const ConfigChecklist = () => import('./pages/ConfigChecklist.vue')

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
        { path: 'products/:id/wizard', component: Wizard }, // 上新分步向导（带参·nav-route 守卫豁免孤儿页检查）
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
        { path: 'scm-overview', component: ScmOverview },
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
        { path: 'config-checklist', component: ConfigChecklist },
      ],
    },
  ],
})

// 会话闸：无令牌一律回登录页（fail-closed·令牌真伪由云端裁决）
// 批量上传在途闸（P1 收口·同日案 M 记债后当批修复）：Wizard.go() 与 Courses.vue 的 onBeforeRouteLeave
// 两处消费 isUploadLocked() 均只挡各自的窄路径——Shell 侧栏「按步骤直达」是裸 router-link 改 query.step
// （仅 query 变化＝路由 update 非 leave，onBeforeRouteLeave 不触发；也不经过 go()）、浏览器前进/后退同样绕开
// 两点式拦截。全局 beforeEach 对任何导航（含仅 query 变化的 update）必过，一次性收口两条旁路 + 未来新增
// 入口，不逐点打补丁。会话分支优先（登录态丢失/手动登出跳 /login 不可被上传锁卡死）：仅当 to.path 不是
// /login 且已通过上方会话检查（代表这是「已登录状态下的页面间导航」）才判上传锁；且只挡真会改变当前路由的
// 导航（fullPath 含 query，同址无效导航放行，无需拦）。
router.beforeEach((to, from) => {
  if (to.path !== '/login' && !client.hasSession()) return '/login'
  if (to.path === '/login' && client.hasSession()) return '/'
  if (to.path !== '/login' && isUploadLocked() && to.fullPath !== from.fullPath) {
    window.alert('批量上传进行中，完成前请勿离开当前步骤')
    return false
  }
  return true
})

// 会话失效集中导登录（单源·根因#5）：任一业务调用遇 401 → client 清令牌后回调此处导登录，
// 各页只需早退不再各写各的跳转（治「卡死加载中/裸显 SESSION_LOST」的页间漂移）。
client.onSessionLost(() => {
  if (router.currentRoute.value.path !== '/login') void router.push('/login')
})
