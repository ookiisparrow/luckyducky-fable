<script setup>
/**
 * 左侧导航（业务域主类目结构·用户拍板方案A 2026-07-02）：
 * - 「数据看板」独立置顶当经营总览入口；其余模块按「商品与内容 / 订单与交易 / 客户服务 / 系统」
 *   四个可折叠主类目收纳（原「经营」一组 9 项混商品/交易/客服，无层次）。
 * - 主类目默认全展开、可手动收起（记 localStorage）；跳进某组页面时该组自动弹开。
 * - 「商品与上新」保持可展开子级（六步向导），进入上新区自动展开，可手动收起。
 * - 导航路径 ↔ router.js 由守卫 admin-nav-route-synced 双向核对（防死链/孤儿页·根因#5）。
 * 直达入口：带着「最近编辑的商品」跳对应步骤；还没有商品时回列表。
 */
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Package, ChevronDown, Image, FileText, Tags, Clapperboard, QrCode, Printer,
  Smartphone, Truck, RotateCcw, Boxes, ChartColumn, Wallet, Bell, ExternalLink, LifeBuoy, UserSearch, ClipboardCheck, MessagesSquare, BookOpen, Star, Users,
  Store, Receipt, Headphones, Settings, Factory, ShoppingCart, Scissors,
} from 'lucide-vue-next'
import { useProductsStore, STEP_NAMES } from '@/store/products.js'
import { logout, currentUser } from '@/api/cloud.js'

const route = useRoute()
const router = useRouter()
const store = useProductsStore()
store.load()

// 「按步骤直达」每步图标（与 design/console.pen Component/Sidebar 同序）
const STEP_ICONS = [Image, FileText, Tags, Clapperboard, QrCode, Printer]

// 业务域主类目（方案A）：key 供折叠状态寻址；「商品与上新」是 catalog 组的特例首项（模板单独渲染）
const GROUPS = [
  {
    key: 'catalog',
    caption: '商品与内容',
    icon: Store,
    items: [
      { to: '/showcase', label: '小程序橱窗', icon: Smartphone },
      { to: '/inventory', label: '库存管理', icon: Boxes },
      { to: '/help-videos', label: '帮助视频', icon: LifeBuoy },
    ],
  },
  {
    key: 'trade',
    caption: '订单与交易',
    icon: Receipt,
    items: [
      { to: '/orders', label: '订单发货', icon: Truck },
      { to: '/refunds', label: '售后退款', icon: RotateCcw },
      { to: '/reconciliation', label: '财务对账', icon: Wallet },
    ],
  },
  {
    key: 'service',
    caption: '客户服务',
    icon: Headphones,
    items: [
      { to: '/conversations', label: '客服会话', icon: MessagesSquare },
      { to: '/customer360', label: '客户360', icon: UserSearch },
      { to: '/checkpoints', label: '节点诊断', icon: ClipboardCheck },
      { to: '/kb', label: '知识库', icon: BookOpen },
      { to: '/csat', label: '客服满意度', icon: Star },
      { to: '/agents', label: '外包账号', icon: Users },
    ],
  },
  {
    // 进销存 SCM（蓝图 docs/进销存ERP/·SCM-0 起）：车道 A/B/C/D 的采购/外协/打包/备货页后续加进本组
    key: 'scm',
    caption: '供应链',
    icon: Factory,
    items: [
      { to: '/scm-materials', label: '物料与供应商', icon: Package },
      { to: '/scm-purchase', label: '采购管理', icon: ShoppingCart },
      { to: '/scm-outwork', label: '外协加工', icon: Scissors },
    ],
  },
  {
    key: 'system',
    caption: '系统',
    icon: Settings,
    items: [
      { to: '/notifications', label: '消息通知', icon: Bell },
      { to: '/externals', label: '外部后台', icon: ExternalLink },
    ],
  },
]

// 主类目折叠状态：默认全展开（collapsed 空表），手动收起记 localStorage；回灌 sanitize 防脏数据
const NAV_COLLAPSED_KEY = 'ld-admin-nav-collapsed'
function loadCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(NAV_COLLAPSED_KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}
const collapsed = ref(loadCollapsed())
function saveCollapsed() {
  localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(collapsed.value))
}
function toggleGroup(key) {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] }
  saveCollapsed()
}

// 路由 → 所在主类目；跳进组内页面时该组自动弹开（收起状态不困住当前页）
function groupOfPath(path) {
  if (path === '/products' || path.startsWith('/product/')) return 'catalog'
  for (const g of GROUPS) if (g.items.some((it) => it.to === path)) return g.key
  return ''
}
watch(
  () => route.path,
  (p) => {
    const k = groupOfPath(p)
    if (k && collapsed.value[k]) {
      collapsed.value = { ...collapsed.value, [k]: false }
      saveCollapsed()
    }
  },
  { immediate: true },
)

// 上新区（列表或向导）= 商品与上新的势力范围；进入即自动展开六步子菜单
const inProductSection = () => route.path === '/products' || route.path.startsWith('/product/')
const expanded = ref(inProductSection())
watch(
  () => route.path,
  () => {
    if (inProductSection()) expanded.value = true
  },
)

function openProducts() {
  expanded.value = true
  router.push('/products')
}
function toggleSteps() {
  expanded.value = !expanded.value
}
function goStep(n) {
  const p = store.list[0]
  if (!p) return router.push('/products')
  router.push(`/product/${p.id}/step/${n}`)
}
function stepActive(n) {
  return route.params.n === String(n)
}
function doLogout() {
  logout()
  router.push('/login')
}
</script>

<template>
  <aside class="side">
    <div class="logo">
      <div class="logo-badge">🦆</div>
      <div>
        <div class="logo-title">Lucky Ducky</div>
        <div class="logo-sub">内容控制台</div>
      </div>
    </div>

    <!-- 数据看板：独立置顶的经营总览入口 -->
    <router-link class="nav" :class="{ on: route.path === '/dashboard' }" to="/dashboard">
      <ChartColumn :size="17" /><span>数据看板</span>
    </router-link>

    <template v-for="g in GROUPS" :key="g.key">
      <button class="group-head" @click="toggleGroup(g.key)">
        <component :is="g.icon" :size="14" />
        <span>{{ g.caption }}</span>
        <ChevronDown :size="14" class="chev" :class="{ open: !collapsed[g.key] }" />
      </button>
      <div v-if="!collapsed[g.key]" class="group-body">
        <!-- 商品与上新（catalog 组特例首项：可再展开六步向导） -->
        <template v-if="g.key === 'catalog'">
          <div class="nav nav-parent" :class="{ on: route.path === '/products' }" @click="openProducts">
            <Package :size="17" /><span>商品与上新</span>
            <button class="chev-btn" title="展开/收起步骤" @click.stop="toggleSteps">
              <ChevronDown :size="15" class="chev" :class="{ open: expanded }" />
            </button>
          </div>
          <div v-if="expanded" class="substeps">
            <button
              v-for="(name, i) in STEP_NAMES"
              :key="i"
              class="nav step"
              :class="{ on: stepActive(i + 1) }"
              @click="goStep(i + 1)"
            >
              <component :is="STEP_ICONS[i]" :size="16" /><span>{{ i + 1 }} · {{ name }}</span>
            </button>
          </div>
        </template>
        <router-link
          v-for="it in g.items"
          :key="it.to"
          class="nav"
          :class="{ on: route.path === it.to }"
          :to="it.to"
        >
          <component :is="it.icon" :size="17" /><span>{{ it.label }}</span>
        </router-link>
      </div>
    </template>

    <div class="spacer"></div>
    <div class="admin">
      <div class="ava">{{ (currentUser() || '管')[0] }}</div>
      <div class="who">
        <div class="who-name">{{ currentUser() || '管理员' }}</div>
        <button class="who-out" @click="doLogout">退出登录</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.side {
  width: 232px;
  flex: 0 0 auto;
  background: var(--white);
  border-right: 1px solid var(--line);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto; /* 全展开条目多，矮屏也要滚得到底部账号区 */
}
.logo {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 8px 24px;
}
.logo-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.logo-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--ink);
}
.logo-sub {
  font-size: 11px;
  color: var(--purple-meta);
}
.nav {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 13.5px;
  color: var(--content-2);
  text-decoration: none;
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
  text-align: left;
}
.nav.on {
  background: var(--bg-lilac);
  border-color: var(--purple-line);
  color: var(--purple-ink);
  font-weight: 600;
}
/* 选中态图标用品牌紫，标签仍是 purple-ink（与设计稿 NavActive 一致） */
.nav.on :deep(svg) {
  color: var(--brand);
}
.nav:hover {
  background: var(--bg-lilac);
}
.nav :deep(svg) {
  flex: 0 0 auto;
}
/* 主类目行：深紫粗体 + 品牌紫图标，与灰色小分类明显区分（层次一眼可辨）；整行可点折叠，标签撑开把箭头推到最右 */
.group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 14px 12px 4px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--purple-ink);
  text-align: left;
}
.group-head > span {
  flex: 1;
}
.group-head :deep(svg) {
  color: var(--brand);
}
.group-head .chev {
  color: var(--purple-meta);
}
.group-head:hover {
  color: var(--brand-active);
}
.group-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* 父项「商品与上新」：标签撑开把折叠箭头推到最右 */
.nav-parent > span {
  flex: 1;
}
.chev-btn {
  border: none;
  background: none;
  padding: 0;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: inherit;
}
.chev {
  transition: transform 0.16s ease;
  transform: rotate(-90deg);
  color: var(--content-2);
}
.chev.open {
  transform: rotate(0deg);
}
/* 六步子菜单：缩进 + 左侧连接线，读作「商品与上新」的子项 */
.substeps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 2px 0 2px 17px;
  padding-left: 9px;
  border-left: 1px solid var(--line);
}
.nav.step {
  padding: 8px 10px;
  font-size: 13px;
}
.spacer {
  flex: 1;
}
.admin {
  display: flex;
  gap: 10px;
  align-items: center;
  border-top: 1px solid var(--line);
  padding: 10px 8px 4px;
}
.ava {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-sage);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.who-name {
  font-size: 12.5px;
  font-weight: 600;
}
.who-out {
  border: none;
  background: none;
  padding: 0;
  font-size: 10.5px;
  color: var(--content-2);
  cursor: pointer;
}
.who-out:hover {
  color: var(--red);
}
</style>
