<script setup lang="ts">
// 数据看板（照 design/控制台.pen PxuIO 视觉语言重写·M-adminImpl 批1）：套新卡片/KPI/表格语言，
// 数据仍全绑云端真值。设计的「成交额趋势柱图 / 热销商品 Top5」当前后端无数据源——不编数（根因#8·T3），
// 保留真实的 KPI/转化漏斗/段位分析/最近动态 + owner 待处理行动条 + 交易异常告警（换皮曾删·复原不再丢）。
// 待接学习分析 action 后再补趋势/热销卡位（记 docs/待办与债.md）。
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Users, ShoppingBag, Wallet, QrCode, GraduationCap, RefreshCw, TriangleAlert, Truck, RotateCcw, Boxes, Flame, PauseCircle, PackagePlus, Inbox } from 'lucide-vue-next'
import { getDashboard, orderCounts, refundCounts } from '../api/money'
import { listInventory } from '../api/system'
import { listDrafts } from '../api/products'
import { mapDashboard, deriveDashboardTodos } from '../lib/mapMoney'
import { mapDraftRows } from '../lib/mapProducts'
import { LOW_STOCK_THRESHOLD } from '../lib/thresholds'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

const LOW = LOW_STOCK_THRESHOLD // 低库存阈值（与 Inventory 同口径·单源见 lib/thresholds.ts）
const router = useRouter()
const vm = ref<ReturnType<typeof mapDashboard>>(null)
const todo = ref({ ship: 0, refund: 0, lowStock: 0, prep: 0 })
const todoPartial = ref(false) // 待处理计数有副请求加载失败＝true（病根#14：别把「没加载到」显示成「无待办」）
const message = ref('加载中…')
const busy = ref(false)

const alertCount = computed(() => (vm.value?.alerts || []).reduce((n, a) => n + a.ids.length, 0))
// 钱链告警按类型定位（P2 修复·根因：getTxAlerts 三类 id 形状不同——feeMismatch 是订单 _id（Orders 页
// 搜索精确匹配 _id 能找到），refundMismatch/stuckRefunds 是 afterSales 复合 _id（`orderId__lineId[__ovrN]`，
// Orders/Refunds 两页搜索都搜不到这种复合 id）。金额不符单唯一对应 Orders 页；其余两类只能去 Refunds 页
// （虽然 Refunds 搜索也不认复合 id，但至少落在能看到售后记录的正确页面——不去 /orders 那种连页面都错的死路）。
const isFeeMismatch = (label: string) => label === '金额不符单'
const alertPath = (label: string) => (isFeeMismatch(label) ? '/orders' : '/refunds')
// 待处理瓦片聚合多个类型、只能给一个落点：混有退款类（stuckRefunds 是需要及时人工介入的死信）就默认去
// /refunds（更紧急）；全是金额不符单（或无告警）保持原 /orders，不引入更复杂的选择菜单（量力而行）。
const alertsHaveRefundType = computed(() => (vm.value?.alerts || []).some((a) => !isFeeMismatch(a.label)))
// 深链预填（债目·全局清零bug战役残余 2026-07-13）：告警行「去处理」跳 /refunds 时若该行恰好 1 个 id，
// 带 ?q=<反解单号> 让 Refunds.vue 深链预填自动检索到具体记录（唯一目标才有「跳到具体记录」语义；
// 多 id/无 id 仍跳纯列表、不带参——现状）。afterSales 复合 id（`orderId__lineId[__ovrN]`）反解取
// split('__')[0]（订单 id 不含下划线·债目已核可靠）；feeMismatch 走 /orders、本次深链范围不含它。
function alertQuery(a: { label: string; ids: string[] }): Record<string, string> {
  if (isFeeMismatch(a.label) || a.ids.length !== 1) return {}
  const raw = a.ids[0]
  return { q: raw.includes('__') ? raw.split('__')[0] : raw }
}
const TODOS = computed(() => [
  { key: 'ship', label: '待发货', n: todo.value.ship, to: '/orders', icon: Truck, tone: 'warn' },
  { key: 'refund', label: '待审退款', n: todo.value.refund, to: '/refunds', icon: RotateCcw, tone: 'warn' },
  { key: 'prep', label: '上新未完成', n: todo.value.prep, to: '/products', icon: PackagePlus, tone: 'warn' },
  { key: 'low', label: '低库存 / 售罄', n: todo.value.lowStock, to: '/inventory', icon: Boxes, tone: 'red' },
  { key: 'money', label: '钱链告警', n: alertCount.value, to: alertsHaveRefundType.value ? '/refunds' : '/orders', icon: TriangleAlert, tone: 'red' },
])
const todoTotal = computed(() => TODOS.value.reduce((s, t) => s + t.n, 0))
const fmtClock = (ts: number) => {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const ACT_LABEL: Record<string, string> = { order: '订单', activate: '激活', enter: '进课', refund: '退款' }

const CARD_ICON: Record<string, any> = {
  用户: Users,
  订单: ShoppingBag,
  成交: Wallet,
  激活: QrCode,
  学习: GraduationCap,
}
function iconFor(label: string) {
  const hit = Object.keys(CARD_ICON).find((k) => label.includes(k))
  return hit ? CARD_ICON[hit] : Users
}

const funnelMax = computed(() => Math.max(1, ...(vm.value?.funnel || []).map((f) => Number(f.value) || 0)))

async function load() {
  busy.value = true
  // 行动条计数复用服务端精确口径（orderCounts/refundCounts·根因#7）+ 库存按 SKU 实算；任一失败不拖累看板
  const [d, oc, rc, inv, dr] = await Promise.all([
    getDashboard(),
    orderCounts().catch(() => ({ ok: false }) as any),
    refundCounts().catch(() => ({ ok: false }) as any),
    listInventory().catch(() => ({ ok: false }) as any),
    listDrafts().catch(() => ({ ok: false }) as any),
  ])
  busy.value = false
  if ((d as any).error === 'SESSION_LOST') return // 会话失效集中导登录（client.onSessionLost·单源·根因#5）
  vm.value = mapDashboard(d)
  // 上新未完成＝筹备中（未上架）商品数（复用 productState 三态口径）；失败副请求由 deriveDashboardTodos
  // 以 .ok 识别、回传 partial——不再兜成 0 把「没加载到」伪装成「无待办」（病根#14）
  const t = deriveDashboardTodos({
    orderCounts: oc as any,
    refundCounts: rc as any,
    inventory: inv as any,
    drafts: { ok: (dr as any)?.ok, rows: (dr as any)?.ok ? mapDraftRows((dr as any).list, (dr as any).urls, (dr as any).listed) : [] },
    low: LOW,
  })
  todo.value = { ship: t.ship, refund: t.refund, lowStock: t.lowStock, prep: t.prep }
  todoPartial.value = t.partial
  message.value = vm.value ? '' : '看板加载失败：' + String((d as any).error || '')
}

onMounted(load)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="数据看板" sub="经营与学习数据一屏总览 · 数字来自云端真实记录">
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="load">
        <RefreshCw :size="14" :stroke-width="1.8" :class="{ spin: busy }" />
        <span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <template v-if="vm">
      <!-- 待处理行动条（owner 行动入口·真值）：数字直接点进对应页 -->
      <Card v-if="todoTotal" title="待处理" :sub="`共 ${todoTotal} 项`">
        <div class="todos">
          <button v-for="t in TODOS" :key="t.key" class="todo" :class="[t.tone, { zero: !t.n }]" @click="router.push(t.to)">
            <component :is="t.icon" :size="18" :stroke-width="1.8" class="todo-ico" />
            <div class="todo-txt"><span class="todo-n">{{ t.n }}</span><span class="todo-l">{{ t.label }}</span></div>
          </button>
        </div>
      </Card>
      <p v-else-if="!todoPartial" class="ok-line">今日无待处理事项 ✓</p>
      <!-- 副请求加载失败：不显绿色全清（病根#14 别把「没加载到」当「无待办」→ 漏发货）·提示刷新 -->
      <p v-if="todoPartial" class="ld-status">部分待处理计数没能加载，显示的数字可能不全，请刷新看真实待办</p>

      <!-- 交易异常告警（有则必显）：每类各带自己的「去处理」——三类 id 形状不同，落点不能共用一个按钮 -->
      <div v-if="vm.alerts.length" class="alert">
        <div class="alert-ico"><TriangleAlert :size="20" :stroke-width="1.8" /></div>
        <div class="alert-body">
          <div class="alert-title">交易异常待处理 · {{ vm.alerts.reduce((n, a) => n + a.ids.length, 0) }} 笔</div>
          <div v-for="a in vm.alerts" :key="a.label" class="alert-row">
            <span class="alert-item">{{ a.label }}：<code v-for="id in a.ids" :key="id">{{ id }}</code></span>
            <UiButton variant="danger" size="sm" @click="router.push({ path: alertPath(a.label), query: alertQuery(a) })">去处理</UiButton>
          </div>
        </div>
      </div>

      <!-- KPI 行（真数据·无环比数据源不编，激活率进度条走 KPI 尾槽） -->
      <div class="ld-kpi-grid">
        <KpiCard v-for="c in vm.cards" :key="c.label" :label="c.label" :value="c.value" :icon="iconFor(c.label)">
          <div v-if="c.pct != null" class="pbar"><i :style="{ width: c.pct + '%' }" /></div>
          <div v-if="c.sub" class="kpi-note">{{ c.sub }}</div>
          <div v-if="c.note" class="kpi-note">{{ c.note }}</div>
        </KpiCard>
      </div>

      <!-- 热点 / 卡点段位分析（后端 hot/stuck 真值） -->
      <div v-if="vm.hot.length || vm.stuck.length" class="ld-cols-2">
        <Card title="最多人看完的段">
          <template #head><Flame :size="16" :stroke-width="1.8" class="seg-ico hot" /></template>
          <p v-if="!vm.hot.length" class="empty">暂无</p>
          <div v-for="(s, i) in vm.hot" :key="'h' + i" class="seg-row">
            <span class="seg-rank">{{ i + 1 }}</span><span class="seg-name">{{ s.name }}</span><b class="seg-count">{{ s.count }}</b>
          </div>
        </Card>
        <Card title="最多人停留的段（卡点）">
          <template #head><PauseCircle :size="16" :stroke-width="1.8" class="seg-ico stuck" /></template>
          <p v-if="!vm.stuck.length" class="empty">暂无</p>
          <div v-for="(s, i) in vm.stuck" :key="'s' + i" class="seg-row">
            <span class="seg-rank">{{ i + 1 }}</span><span class="seg-name">{{ s.name }}</span><b class="seg-count">{{ s.count }}</b>
          </div>
        </Card>
      </div>
      <p v-if="vm.approxSeg" class="approx-note">热点/卡点为抽样估算（学员多时按样本近似·诚实标注）</p>

      <!-- 转化漏斗 + 最近动态（真数据） -->
      <div class="ld-cols-2">
        <Card title="转化漏斗" sub="下单 → 支付 → 激活">
          <div v-for="f in vm.funnel" :key="f.label" class="funnel-row">
            <span class="funnel-label">{{ f.label }}</span>
            <div class="funnel-track">
              <div class="funnel-bar" :style="{ width: (Number(f.value) / funnelMax) * 100 + '%' }" />
            </div>
            <span class="funnel-value">{{ f.value }}</span>
            <span class="funnel-conv">{{ f.sub || '—' }}</span>
          </div>
        </Card>

        <Card title="最近动态" sub="订单 · 激活 · 进课 · 退款">
          <EmptyState v-if="!vm.recent.length" :icon="Inbox" text="暂无动态" />
          <div v-for="(e, i) in vm.recent" :key="i" class="act-row">
            <span class="act-type" :class="e.type">{{ ACT_LABEL[e.type] || e.type }}</span>
            <span class="act-text">{{ e.text }}</span>
            <span class="act-time">{{ fmtClock(e.at) }}</span>
          </div>
        </Card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.ok-line {
  margin: 0;
  font-size: 13px;
  color: var(--ld-green);
}
/* 交易异常告警条 */
.alert {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 20px;
  background: var(--ld-bg-red-soft);
  border: 1px solid var(--ld-red-line);
  border-radius: var(--ld-radius);
}
.alert-ico {
  color: var(--ld-red);
  flex: none;
  margin-top: 2px;
}
.alert-body {
  flex: 1;
  min-width: 0;
}
.alert-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-red);
}
/* 每类各一行、各带自己的「去处理」（三类 id 形状不同，落点不能共用一个按钮） */
.alert-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 8px;
}
.alert-item {
  font-size: 12.5px;
  color: var(--ld-content);
  flex: 1;
  min-width: 0;
}
.alert-item code {
  margin-left: 4px;
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
}
/* 待处理行动条 tiles */
.todos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.todo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  cursor: pointer;
  text-align: left;
}
.todo-ico {
  color: var(--ld-content-2);
  flex: none;
}
.todo-txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.todo-n {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--ld-ink);
}
.todo-l {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.todo.warn:not(.zero) {
  border-color: var(--ld-amber);
  background: var(--ld-bg-amber-soft);
}
.todo.warn:not(.zero) .todo-n,
.todo.warn:not(.zero) .todo-ico {
  color: var(--ld-amber);
}
.todo.red:not(.zero) {
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
.todo.red:not(.zero) .todo-n,
.todo.red:not(.zero) .todo-ico {
  color: var(--ld-red);
}
.todo.zero {
  opacity: 0.6;
}
/* KPI 尾槽：激活率进度条 + 说明 */
.pbar {
  height: 8px;
  background: var(--ld-bg-lilac);
  border-radius: 999px;
  overflow: hidden;
}
.pbar i {
  display: block;
  height: 100%;
  background: var(--ld-brand);
  border-radius: 999px;
}
.kpi-note {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
/* 段位分析 */
.seg-ico.hot {
  color: var(--ld-red);
}
.seg-ico.stuck {
  color: var(--ld-amber);
}
.empty {
  font-size: 13px;
  color: var(--ld-content-2);
}
.seg-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
}
.seg-row:first-of-type {
  border-top: none;
}
.seg-rank {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--ld-bg-lilac);
  color: var(--ld-content-2);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.seg-name {
  flex: 1;
  min-width: 0;
  color: var(--ld-content);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.seg-count {
  flex: none;
  color: var(--ld-ink);
}
.approx-note {
  margin: 0;
  font-size: 11px;
  color: var(--ld-amber);
}
/* 转化漏斗 */
.funnel-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}
.funnel-label {
  width: 44px;
  flex: none;
  font-size: 12.5px;
  color: var(--ld-content);
}
.funnel-track {
  flex: 1;
  height: 10px;
  background: var(--ld-bg-lilac);
  border-radius: 999px;
  overflow: hidden;
}
.funnel-bar {
  height: 100%;
  background: var(--ld-brand);
  border-radius: 999px;
  min-width: 4px;
}
.funnel-value {
  width: 56px;
  flex: none;
  text-align: right;
  font-size: 13px;
  font-weight: 700;
  color: var(--ld-ink);
}
.funnel-conv {
  width: 76px;
  flex: none;
  text-align: right;
  font-size: 11px;
  color: var(--ld-content-2);
}
/* 最近动态 */
.act-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px solid var(--ld-line);
  font-size: 12.5px;
}
.act-row:first-of-type {
  border-top: none;
}
.act-type {
  flex: none;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--ld-bg-lilac);
  color: var(--ld-content-2);
}
.act-type.order {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.act-type.activate,
.act-type.enter {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.act-type.refund {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.act-text {
  flex: 1;
  min-width: 0;
  color: var(--ld-content);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.act-time {
  flex: none;
  font-size: 11px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
</style>
