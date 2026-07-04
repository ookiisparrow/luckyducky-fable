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
