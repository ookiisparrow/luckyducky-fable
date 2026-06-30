<script setup>
/**
 * 左侧导航（按 design/console.pen「Component/Sidebar」对齐 + 用户拍板：上新六步收进「商品与上新」内）：
 * - 「商品与上新」是可展开父项，六步作为子菜单缩进其下；进入上新区（列表/向导）自动展开，可手动收起。
 * - 其余模块按 经营 / 数据 / 系统 三组小标题分组。
 * 直达入口：带着「最近编辑的商品」跳对应步骤；还没有商品时回列表。
 */
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Package, ChevronDown, Image, FileText, Tags, Clapperboard, QrCode, Printer,
  Smartphone, Truck, RotateCcw, Boxes, ChartColumn, Wallet, Bell, ExternalLink, LifeBuoy, UserSearch, ClipboardCheck, BookOpen, Star,
} from 'lucide-vue-next'
import { useProductsStore, STEP_NAMES } from '@/store/products.js'
import { logout, currentUser } from '@/api/cloud.js'

const route = useRoute()
const router = useRouter()
const store = useProductsStore()
store.load()

// 「按步骤直达」每步图标（与 design/console.pen Component/Sidebar 同序）
const STEP_ICONS = [Image, FileText, Tags, Clapperboard, QrCode, Printer]

// 分组导航（设计稿小标题语言延伸到 v1 之后新增的 7 个模块）
const GROUPS = [
  {
    caption: '经营',
    items: [
      { to: '/showcase', label: '小程序橱窗', icon: Smartphone },
      { to: '/help-videos', label: '帮助视频', icon: LifeBuoy },
      { to: '/orders', label: '订单发货', icon: Truck },
      { to: '/refunds', label: '售后退款', icon: RotateCcw },
      { to: '/customer360', label: '客户360', icon: UserSearch },
      { to: '/inventory', label: '库存管理', icon: Boxes },
      { to: '/checkpoints', label: '节点诊断', icon: ClipboardCheck },
      { to: '/kb', label: '知识库', icon: BookOpen },
    ],
  },
  {
    caption: '数据',
    items: [
      { to: '/dashboard', label: '数据看板', icon: ChartColumn },
      { to: '/csat', label: '客服满意度', icon: Star },
      { to: '/reconciliation', label: '财务对账', icon: Wallet },
    ],
  },
  {
    caption: '系统',
    items: [
      { to: '/notifications', label: '消息通知', icon: Bell },
      { to: '/externals', label: '外部后台', icon: ExternalLink },
    ],
  },
]

// 上新区（列表或向导）= 商品与上新的势力范围；进入即自动展开六步子菜单
const inProductSection = computed(
  () => route.path === '/products' || route.path.startsWith('/product/'),
)
const expanded = ref(inProductSection.value)
watch(inProductSection, (v) => {
  if (v) expanded.value = true
})

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

    <!-- 商品与上新（可展开父项，六步收其内） -->
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

    <template v-for="g in GROUPS" :key="g.caption">
      <div class="caption">{{ g.caption }}</div>
      <router-link
        v-for="it in g.items"
        :key="it.to"
        class="nav"
        :class="{ on: route.path === it.to }"
        :to="it.to"
      >
        <component :is="it.icon" :size="17" /><span>{{ it.label }}</span>
      </router-link>
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
.caption {
  padding: 14px 12px 4px;
  font-size: 10.5px;
  letter-spacing: 0.5px;
  color: var(--purple-meta);
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
