<script setup lang="ts">
// 壳布局（M3 信息架构：按运营动作六组重排）。视觉按 design/console.pen Component/Sidebar 规格：
// 232px 白底右分线、鸭徽 logo、分组小标题、图标导航项（active=淡紫底+紫描边）、底部管理员条。
// 设计稿侧栏只画了重设计屏子集；六组全量 IA 是 M3「运营动作零缺失」要求，保留不裁（刻意偏离，见重构日志）。
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ChevronDown,
  ChartColumn,
  Package,
  GraduationCap,
  Store,
  LayoutGrid,
  Clapperboard,
  Truck,
  PackageCheck,
  RotateCcw,
  Receipt,
  Boxes,
  MessagesSquare,
  UserSearch,
  BookOpen,
  Smile,
  Activity,
  Warehouse,
  ClipboardList,
  Handshake,
  Blocks,
  CalendarRange,
  Users,
  QrCode,
  Settings,
  ExternalLink,
  ShieldCheck,
  Siren,
  LogOut,
} from 'lucide-vue-next'
import { client } from '../api'

const router = useRouter()
const who = client.who() // 真实登录身份（换皮硬编码「管理员」·多账号无法辨认当前是谁）

const NAV = [
  { group: '总览', items: [{ label: '数据看板', path: '/', icon: ChartColumn }] },
  {
    group: '商品与内容',
    items: [
      { label: '商品管理', path: '/products', icon: Package },
      { label: '课程管理', path: '/courses', icon: GraduationCap },
      { label: '小程序橱窗', path: '/showcase', icon: Store },
      { label: '首页内容', path: '/home-content', icon: LayoutGrid },
      { label: '帮助视频', path: '/help-videos', icon: Clapperboard },
    ],
  },
  {
    group: '订单与钱',
    items: [
      { label: '订单发货', path: '/orders', icon: Truck },
      { label: '发货工作台', path: '/fulfill', icon: PackageCheck },
      { label: '售后退款', path: '/refunds', icon: RotateCcw },
      { label: '财务对账', path: '/reconciliation', icon: Receipt },
      { label: '实物库存', path: '/inventory', icon: Boxes },
    ],
  },
  {
    group: '客服',
    items: [
      { label: '客服会话', path: '/conversations', icon: MessagesSquare },
      { label: '客户 360', path: '/customer360', icon: UserSearch },
      { label: '知识库', path: '/kb', icon: BookOpen },
      { label: '满意度', path: '/csat', icon: Smile },
      { label: '节点诊断', path: '/checkpoints', icon: Activity },
    ],
  },
  {
    group: '进销存',
    items: [
      { label: '物料与供应商', path: '/scm-materials', icon: Warehouse },
      { label: '采购单', path: '/scm-purchase', icon: ClipboardList },
      { label: '外协单', path: '/scm-outwork', icon: Handshake },
      { label: '配方与组装', path: '/scm-bom', icon: Blocks },
      { label: '备货与产销', path: '/scm-planner', icon: CalendarRange },
    ],
  },
  {
    group: '系统',
    items: [
      { label: '系统巡检', path: '/inspect', icon: ShieldCheck },
      { label: '异常监测', path: '/anomalies', icon: Siren },
      { label: '外包账号', path: '/agents', icon: Users },
      { label: '激活码批次', path: '/batches', icon: QrCode },
      { label: '外部后台', path: '/external', icon: ExternalLink },
      { label: '系统设置', path: '/settings', icon: Settings },
    ],
  },
]

// 侧栏分组折叠（换皮丢了折叠/持久·24 项平铺偏长）：localStorage 记忆 + 进组自动展开
const route = useRoute()
const COLLAPSE_KEY = 'ldrw-admin-nav-collapsed'
function loadCollapsed(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')
    return new Set(Array.isArray(v) ? (v as string[]) : [])
  } catch {
    return new Set()
  }
}
const collapsed = ref<Set<string>>(loadCollapsed())
function toggleGroup(g: string) {
  const s = new Set(collapsed.value)
  s.has(g) ? s.delete(g) : s.add(g)
  collapsed.value = s
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]))
}
// 当前路由所在组强制展开（进组自动展开·不受折叠影响）；否则看用户折叠态
const isOpen = (g: { group: string; items: Array<{ path: string }> }) =>
  g.items.some((it) => it.path === route.path) || !collapsed.value.has(g.group)

function logout() {
  client.logout()
  void router.push('/login')
}
</script>

<template>
  <div class="shell">
    <aside>
      <div class="logo">
        <div class="logo-badge">🦆</div>
        <div class="logo-text">
          <div class="logo-title">Lucky Ducky</div>
          <div class="logo-sub">小棉鸭 · 管理控制台</div>
        </div>
      </div>
      <nav>
        <div v-for="g in NAV" :key="g.group" class="group">
          <button class="group-title" @click="toggleGroup(g.group)">
            <span>{{ g.group }}</span>
            <ChevronDown class="grp-caret" :class="{ closed: !isOpen(g) }" :size="13" :stroke-width="2" />
          </button>
          <template v-if="isOpen(g)">
            <router-link v-for="it in g.items" :key="it.path" :to="it.path" class="item">
              <component :is="it.icon" class="item-icon" :size="17" :stroke-width="1.8" />
              <span>{{ it.label }}</span>
            </router-link>
          </template>
        </div>
      </nav>
      <div class="admin">
        <div class="admin-avatar">{{ (who || '管')[0] }}</div>
        <div class="admin-text">
          <div class="admin-name">{{ who || '管理员' }}</div>
          <div class="admin-role">口令会话</div>
        </div>
        <button class="logout" title="退出登录" @click="logout">
          <LogOut :size="15" :stroke-width="1.8" />
          <span>退出</span>
        </button>
      </div>
    </aside>
    <main>
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}
aside {
  width: 232px;
  flex: none;
  padding: 20px 16px;
  background: var(--ld-bg);
  border-right: 1px solid var(--ld-line);
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 20px;
}
.logo-badge {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  background: var(--ld-brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.logo-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ld-ink);
  line-height: 1.2;
}
.logo-sub {
  font-size: 11px;
  color: var(--ld-purple-meta);
  margin-top: 2px;
}
.group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--ld-purple-meta);
  padding: 14px 12px 4px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
}
.grp-caret {
  color: var(--ld-content-2);
  transition: transform 0.15s;
}
.grp-caret.closed {
  transform: rotate(-90deg);
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  margin-bottom: 2px;
  border: 1px solid transparent;
  border-radius: var(--ld-radius-item);
  font-size: 13.5px;
  color: var(--ld-content-2);
  text-decoration: none;
  line-height: 1.3;
}
.item-icon {
  flex: none;
}
.item:hover {
  background: var(--ld-bg-faint);
  color: var(--ld-content);
}
.item.router-link-exact-active {
  background: var(--ld-bg-lilac);
  border-color: var(--ld-purple-line);
  color: var(--ld-purple-ink);
  font-weight: 600;
}
.item.router-link-exact-active .item-icon {
  color: var(--ld-brand);
}
.admin {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 8px 4px;
  border-top: 1px solid var(--ld-line);
}
.admin-avatar {
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 999px;
  background: var(--ld-bg-sage);
  color: var(--ld-content);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.admin-text {
  flex: 1;
  min-width: 0;
}
.admin-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-content);
}
.admin-role {
  font-size: 10.5px;
  color: var(--ld-content-2);
  margin-top: 1px;
}
.logout {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ld-content-2);
  font-size: 11.5px;
  cursor: pointer;
}
.logout:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
main {
  flex: 1;
  min-width: 0;
  padding: 28px 36px;
}
</style>
