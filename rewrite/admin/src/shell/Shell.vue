<script setup lang="ts">
// 壳布局（照 design/控制台.pen 侧栏 nsvaZ 重写·M-adminImpl 批F）：248px 白侧栏（右 $line 分线）、
// 鸭徽 logo「运营控制台」、「导航」小标题 + 编辑排序 chip、6 顶层（数据看板=独立项·其余=可展开组）、
// 底部管理员条。进上新向导路由切「按步直达」聚焦步导航（决策§27②·lib/nav）。
//
// IA 归置说明（交付时待用户确认）：设计把「商品与上新 / 进销存」画成单项工作流入口，但现实现各有
// 6 / 5 个子页——为让 30 页全可达（守卫 rw-admin-nav-route-synced 要求 nav↔route 双向同步）且不丢功能，
// 此二者暂做成可展开组；IA 收尾定稿后可收成纯工作流入口。NAV 每个 path 都内联在此（守卫扫本文件）。
import { ref, computed, type Component } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ChartColumn,
  Tag,
  Package,
  Headset,
  Factory,
  Settings,
  ChevronRight,
  Pencil,
  LogOut,
  Image,
  FileText,
  Tags,
  Clapperboard,
  QrCode,
  Printer,
} from 'lucide-vue-next'
import { client } from '../api'
import { isWizardPath, WIZARD_STEPS, wizardStepFromQuery, currentNavGroup } from '../lib/nav'

const router = useRouter()
const who = client.who() // 真实登录身份

// 顶层 6 组（数据看板=独立项 solo；其余=可展开组）。每项 path 内联在此=守卫扫描面。
const NAV: Array<{ group: string; icon: Component; solo?: boolean; items: Array<{ label: string; path: string }> }> = [
  { group: '数据看板', icon: ChartColumn, solo: true, items: [{ label: '数据看板', path: '/' }] },
  {
    group: '商品与上新',
    icon: Tag,
    items: [
      { label: '商品管理', path: '/products' },
      { label: '课程管理', path: '/courses' },
      { label: '卡片设计', path: '/cards' },
      { label: '小程序橱窗', path: '/showcase' },
      { label: '页面内容', path: '/page-content' },
      { label: '帮助视频', path: '/help-videos' },
    ],
  },
  {
    group: '订单履约',
    icon: Package,
    items: [
      { label: '订单发货', path: '/orders' },
      { label: '发货工作台', path: '/fulfill' },
      { label: '售后退款', path: '/refunds' },
      { label: '财务对账', path: '/reconciliation' },
      { label: '实物库存', path: '/inventory' },
    ],
  },
  {
    group: '客服 360',
    icon: Headset,
    items: [
      { label: '客服会话', path: '/conversations' },
      { label: '客户 360', path: '/customer360' },
      { label: '知识库', path: '/kb' },
      { label: '满意度', path: '/csat' },
      { label: '节点诊断', path: '/checkpoints' },
    ],
  },
  {
    group: '进销存',
    icon: Factory,
    items: [
      { label: '物料与供应商', path: '/scm-materials' },
      { label: '采购单', path: '/scm-purchase' },
      { label: '外协单', path: '/scm-outwork' },
      { label: '配方与组装', path: '/scm-bom' },
      { label: '备货与产销', path: '/scm-planner' },
    ],
  },
  {
    group: '系统',
    icon: Settings,
    items: [
      { label: '系统巡检', path: '/inspect' },
      { label: '异常监测', path: '/anomalies' },
      { label: '外包账号', path: '/agents' },
      { label: '激活码批次', path: '/batches' },
      { label: '外部后台', path: '/external' },
      { label: '系统设置', path: '/settings' },
    ],
  },
]

const route = useRoute()
// 上下文侧栏（决策§27②）：进上新向导路由切「按步直达」聚焦步导航，否则六组运营 nav
const wizardMode = computed(() => isWizardPath(route.path))
const curStep = computed(() => wizardStepFromQuery(route.query.step))
const STEP_ICONS: Record<string, Component> = { image: Image, 'file-text': FileText, tags: Tags, clapperboard: Clapperboard, 'qr-code': QrCode, printer: Printer }

// 分组默认收起（照设计·chevron-right）；当前路由所在组自动展开；用户手动展开记 localStorage
const EXPAND_KEY = 'ldrw-admin-nav-expanded'
function loadExpanded(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(EXPAND_KEY) || '[]')
    return new Set(Array.isArray(v) ? (v as string[]) : [])
  } catch {
    return new Set()
  }
}
const expanded = ref<Set<string>>(loadExpanded())
// 当前路由所在组（恒展开·组头点击视作 no-op）——防组头 toggle 把 route 命中的当前组悄悄塞进持久展开集
// （可见态被 route 命中盖过恒不变、却把该组反向写进 localStorage 下次点才移·意图反转·P3·根因#8）
const curGroup = computed(() => currentNavGroup(NAV, route.path))
function toggleGroup(g: string) {
  if (g === curGroup.value) return // 当前组恒开·组头点击不做「翻转 expanded」的无效且污染 localStorage 的写
  const s = new Set(expanded.value)
  s.has(g) ? s.delete(g) : s.add(g)
  expanded.value = s
  localStorage.setItem(EXPAND_KEY, JSON.stringify([...s]))
}
const isOpen = (g: { group: string; items: Array<{ path: string }> }) =>
  curGroup.value === g.group || expanded.value.has(g.group)

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
          <div class="logo-sub">运营控制台</div>
        </div>
      </div>

      <!-- 向导路由=按步直达聚焦；否则=六组运营 nav -->
      <nav v-if="wizardMode" class="nav">
        <router-link to="/products" class="wiz-head">
          <Tag class="item-icon" :size="17" :stroke-width="1.8" />
          <span>商品与上新</span>
        </router-link>
        <div class="nav-cap"><span>按步骤直达</span></div>
        <router-link
          v-for="s in WIZARD_STEPS"
          :key="s.n"
          :to="{ path: route.path, query: { ...route.query, step: s.n } }"
          class="item wiz-step"
          :class="{ 'wiz-on': curStep === s.n }"
        >
          <component :is="STEP_ICONS[s.icon]" class="item-icon" :size="17" :stroke-width="1.8" />
          <span>{{ s.n }} · {{ s.label }}</span>
        </router-link>
        <div class="spacer" />
      </nav>

      <nav v-else class="nav">
        <div class="nav-cap">
          <span>导航</span>
          <span class="reorder" title="侧栏拖拽排序即将支持"><Pencil :size="12" :stroke-width="1.8" /> 编辑排序</span>
        </div>
        <template v-for="n in NAV" :key="n.group">
          <!-- 独立项（数据看板） -->
          <router-link v-if="n.solo" :to="n.items[0].path" class="item">
            <component :is="n.icon" class="item-icon" :size="17" :stroke-width="1.8" />
            <span>{{ n.items[0].label }}</span>
          </router-link>
          <!-- 可展开组 -->
          <div v-else class="group">
            <button class="group-head" @click="toggleGroup(n.group)">
              <ChevronRight class="grp-caret" :class="{ open: isOpen(n) }" :size="15" :stroke-width="2" />
              <component :is="n.icon" class="grp-icon" :size="17" :stroke-width="1.8" />
              <span class="grp-label">{{ n.group }}</span>
            </button>
            <template v-if="isOpen(n)">
              <router-link v-for="it in n.items" :key="it.path" :to="it.path" class="child">
                <i class="child-dot" />
                <span>{{ it.label }}</span>
              </router-link>
            </template>
          </div>
        </template>
        <div class="spacer" />
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
  width: 248px;
  flex: none;
  padding: 20px 14px;
  background: var(--ld-bg);
  border-right: 1px solid var(--ld-line);
  display: flex;
  flex-direction: column;
  gap: 3px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 16px;
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
.nav {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}
.nav-cap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 6px 12px;
  font-size: 10.5px;
  letter-spacing: 0.5px;
  color: var(--ld-purple-meta);
}
.reorder {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--ld-purple-meta);
  cursor: default;
}
/* 项（独立项 + 向导步） */
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px 9px 12px;
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
/* 向导步链接排除在 router-link-exact-active 之外（6 步同 path 仅 query.step 不同·exact-active 不看 query→6 步会
 * 全部命中同时高亮·当前步指示失效）——步高亮单独由 .wiz-step.wiz-on 驱动（P2·根因#8）。 */
.item.router-link-exact-active:not(.wiz-step) {
  background: var(--ld-bg-lilac);
  border-color: var(--ld-purple-line);
  color: var(--ld-purple-ink);
  font-weight: 600;
}
.item.router-link-exact-active:not(.wiz-step) .item-icon {
  color: var(--ld-brand);
}
/* 组头 */
.group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  background: none;
  border-radius: var(--ld-radius-item);
  cursor: pointer;
  text-align: left;
}
.group-head:hover {
  background: var(--ld-bg-faint);
}
.grp-caret {
  color: var(--ld-content-2);
  flex: none;
  transition: transform 0.15s;
}
.grp-caret.open {
  transform: rotate(90deg);
}
.grp-icon {
  color: var(--ld-content-2);
  flex: none;
}
.grp-label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ld-ink);
}
/* 组内子项：缩进 + 圆点 */
.child {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 7px 42px;
  border: 1px solid transparent;
  border-radius: var(--ld-radius-item);
  font-size: 13px;
  color: var(--ld-content-2);
  text-decoration: none;
  line-height: 1.3;
}
.child-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 999px;
  background: currentColor;
}
.child:hover {
  background: var(--ld-bg-faint);
  color: var(--ld-content);
}
.child.router-link-exact-active {
  background: var(--ld-bg-lilac);
  border-color: var(--ld-purple-line);
  color: var(--ld-purple-ink);
  font-weight: 600;
}
.child.router-link-exact-active .child-dot {
  background: var(--ld-brand);
}
/* 向导头 + 步 */
.wiz-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius-item);
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-ink);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
}
.wiz-head .item-icon {
  color: var(--ld-brand);
}
.wiz-step.wiz-on {
  background: var(--ld-bg-lilac);
  border-color: var(--ld-purple-line);
  color: var(--ld-purple-ink);
  font-weight: 600;
}
.wiz-step.wiz-on .item-icon {
  color: var(--ld-brand);
}
.spacer {
  flex: 1;
}
.admin {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px 4px;
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
  padding: 26px 32px;
  background: var(--ld-bg-grey);
}
</style>
