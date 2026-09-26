// 路由（hash·静态托管友好）。信息架构按运营动作分组（非侧栏平铺）：
// 总览 / 商品与内容 / 订单与钱 / 客服 / 进销存 / 系统 六组。
import { createRouter, createWebHashHistory } from 'vue-router'
import { client } from './api'
import { isUploadLocked } from './lib/uploadLock'
import { hasPendingSaves } from './lib/serialSave'
import { isWizardPath } from './lib/nav'

const Wizard = () => import('./pages/Wizard.vue')

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/Login.vue') },
    {
      path: '/',
      component: () => import('./shell/Shell.vue'),
      children: [
        { path: '', component: () => import('./pages/Dashboard.vue') },
        { path: 'orders', component: () => import('./pages/Orders.vue') },
        { path: 'fulfill', component: () => import('./pages/Fulfill.vue') },
        { path: 'refunds', component: () => import('./pages/Refunds.vue') },
        { path: 'products', component: () => import('./pages/Products.vue') },
        { path: 'launch', component: Wizard }, // 上新入口：无编号时第 1 步建档，建完进 /products/:id/wizard
        { path: 'products/:id/wizard', component: Wizard }, // 上新分步向导（带参）
        { path: 'showcase', component: () => import('./pages/Showcase.vue') },
        { path: 'reviews', component: () => import('./pages/Reviews.vue') },
        { path: 'page-content', component: () => import('./pages/PageContent.vue') }, // 页面内容五页签工作台（首页内容并入）
        { path: 'help-videos', component: () => import('./pages/HelpVideos.vue') },
        { path: 'courses', component: () => import('./pages/Courses.vue') },
        { path: 'cards', component: () => import('./pages/Cards.vue') },
        { path: 'conversations', component: () => import('./pages/Conversations.vue') },
        { path: 'customer360', component: () => import('./pages/Customer360.vue') },
        { path: 'kb', component: () => import('./pages/Kb.vue') },
        { path: 'csat', component: () => import('./pages/Csat.vue') },
        { path: 'checkpoints', component: () => import('./pages/Checkpoints.vue') },
        { path: 'scm-overview', component: () => import('./pages/ScmOverview.vue') },
        { path: 'scm-materials', component: () => import('./pages/ScmMaterials.vue') },
        { path: 'scm-purchase', component: () => import('./pages/ScmPurchase.vue') },
        { path: 'scm-outwork', component: () => import('./pages/ScmOutwork.vue') },
        { path: 'scm-bom', component: () => import('./pages/ScmBom.vue') },
        { path: 'scm-planner', component: () => import('./pages/ScmPlanner.vue') },
        { path: 'agents', component: () => import('./pages/Agents.vue') },
        { path: 'batches', component: () => import('./pages/Batches.vue') },
        { path: 'settings', component: () => import('./pages/Settings.vue') },
        { path: 'reconciliation', component: () => import('./pages/Reconciliation.vue') },
        { path: 'inventory', component: () => import('./pages/Inventory.vue') },
        { path: 'external', component: () => import('./pages/External.vue') },
        { path: 'inspect', component: () => import('./pages/Inspect.vue') },
        { path: 'anomalies', component: () => import('./pages/Anomalies.vue') },
        { path: 'config-checklist', component: () => import('./pages/ConfigChecklist.vue') },
        { path: 'audit', component: () => import('./pages/Audit.vue') },
      ],
    },
  ],
})

// 会话闸：无令牌一律回登录页（fail-closed·令牌真伪由云端裁决）
// 批量上传在途闸：Wizard.go() 与 Courses.vue 的 onBeforeRouteLeave
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
  // 旧 step=6 深链兼容：落到合并后的第 5 步（卡片上传 + 二维码）
  if (isWizardPath(to.path) && String(to.query.step) === '6') {
    return { path: to.path, query: { ...to.query, step: '5' }, replace: true }
  }
  return true
})

// 会话失效集中导登录（单源·根因#5）：任一业务调用遇 401 → client 清令牌后回调此处导登录，
// 各页只需早退不再各写各的跳转（治「卡死加载中/裸显 SESSION_LOST」的页间漂移）。
// 未保存编辑提示：会话过期即时跳登录页，未落盘的表单编辑会随组件卸载静默丢失、
// 零提示。hasPendingSaves() 复用 serialSave 共享槽位的在途/待补存状态（各页 autosave 走 key 版 serialSave
// 后天然登记在同一处，不需要各页各自维护一份 dirty ref）——命中即说明这次过期可能正好打断了一次未落盘的
// 编辑，跳转前用 alert 提一句（至少不悄无声息）。
client.onSessionLost(() => {
  if (router.currentRoute.value.path !== '/login') {
    if (hasPendingSaves()) window.alert('登录已过期，本次未保存的编辑可能丢失，请重新登录后检查')
    void router.push('/login')
  }
})
