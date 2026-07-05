<script setup lang="ts">
// 数据看板（design/console.pen S12 视觉·M3 UI 批2）：交易异常横幅（有则必显）+ 经营统计卡（真数据）
// + 转化漏斗 + 最近订单。设计稿的趋势%/迷你柱/热点卡点段位分析当前后端无数据源——不编数，
// 留待独立学习分析 action（记 docs/待办与债.md），本页只渲染 getDashboard/listOrders 真值。
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Users, ShoppingBag, Wallet, QrCode, GraduationCap, RefreshCw, TriangleAlert, Truck, RotateCcw, Boxes, Flame, PauseCircle } from 'lucide-vue-next'
import { getDashboard, orderCounts, refundCounts } from '../api/money'
import { listInventory } from '../api/system'
import { mapDashboard } from '../lib/mapMoney'

const LOW = 10 // 低库存阈值（与 Inventory 同口径·前端预警线）
const router = useRouter()
const vm = ref<ReturnType<typeof mapDashboard>>(null)
const todo = ref({ ship: 0, refund: 0, lowStock: 0 })
const message = ref('加载中…')
const busy = ref(false)

const alertCount = computed(() => (vm.value?.alerts || []).reduce((n, a) => n + a.ids.length, 0))
const TODOS = computed(() => [
  { key: 'ship', label: '待发货', n: todo.value.ship, to: '/orders', icon: Truck, tone: 'warn' },
  { key: 'refund', label: '待审退款', n: todo.value.refund, to: '/refunds', icon: RotateCcw, tone: 'warn' },
  { key: 'low', label: '低库存 / 售罄', n: todo.value.lowStock, to: '/inventory', icon: Boxes, tone: 'red' },
  { key: 'money', label: '钱链告警', n: alertCount.value, to: '/orders', icon: TriangleAlert, tone: 'red' },
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
  const [d, oc, rc, inv] = await Promise.all([
    getDashboard(),
    orderCounts().catch(() => ({}) as any),
    refundCounts().catch(() => ({}) as any),
    listInventory().catch(() => ({}) as any),
  ])
  busy.value = false
  if ((d as any).error === 'SESSION_LOST') {
    void router.push('/login')
    return
  }
  vm.value = mapDashboard(d)
  const ocC = (oc as any)?.counts || {}
  const rcC = (rc as any)?.counts || {}
  const invList = Array.isArray((inv as any)?.list) ? (inv as any).list : []
  todo.value = {
    ship: Number(ocC.paid) || 0,
    refund: Number(rcC.applied) || 0,
    lowStock: invList.filter((r: any) => typeof r?.stock === 'number' && r.stock <= LOW).length,
  }
  message.value = vm.value ? '' : '看板加载失败：' + String((d as any).error || '')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>数据看板</h1>
        <p class="sub">经营与学习数据一屏总览 · 数字来自云端真实记录</p>
      </div>
      <button class="btn-refresh" :disabled="busy" @click="load">
        <RefreshCw :size="15" :stroke-width="1.8" :class="{ spin: busy }" />
        <span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </button>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <template v-if="vm">
      <!-- 待处理行动条（换皮删了这块·看板核心价值「owner 行动入口」）：数字直接点进对应页 -->
      <section v-if="todoTotal" class="todobar">
        <div class="todobar-head">待处理 · 共 {{ todoTotal }} 项</div>
        <div class="todos">
          <button v-for="t in TODOS" :key="t.key" class="todo" :class="[t.tone, { zero: !t.n }]" @click="router.push(t.to)">
            <component :is="t.icon" :size="17" :stroke-width="1.8" class="todo-ico" />
            <div class="todo-txt"><span class="todo-n">{{ t.n }}</span><span class="todo-l">{{ t.label }}</span></div>
          </button>
        </div>
      </section>
      <p v-else class="ok-line">今日无待处理事项 ✓</p>

      <div v-if="vm.alerts.length" class="alert">
        <div class="alert-ico"><TriangleAlert :size="20" :stroke-width="1.8" /></div>
        <div class="alert-body">
          <div class="alert-title">交易异常待处理 · {{ vm.alerts.reduce((n, a) => n + a.ids.length, 0) }} 笔</div>
          <div class="alert-detail">
            <span v-for="a in vm.alerts" :key="a.label" class="alert-item">
              {{ a.label }}：<code v-for="id in a.ids" :key="id">{{ id }}</code>
            </span>
          </div>
        </div>
        <button class="btn-danger" @click="router.push('/orders')">去处理</button>
      </div>

      <div class="stat-grid">
        <div v-for="c in vm.cards" :key="c.label" class="stat-card">
          <div class="stat-head">
            <span class="stat-label">{{ c.label }}</span>
            <component :is="iconFor(c.label)" class="stat-ico" :size="18" :stroke-width="1.8" />
          </div>
          <div class="stat-value">{{ c.value }}</div>
          <div v-if="c.note" class="stat-note">{{ c.note }}</div>
        </div>
      </div>

      <!-- 热点 / 卡点段位分析（B5·后端 hot/stuck 仍返回·换皮误当「无数据源」删掉） -->
      <div v-if="vm.hot.length || vm.stuck.length" class="panels">
        <section class="panel">
          <div class="panel-head"><h2>最多人看完的段</h2><Flame :size="16" :stroke-width="1.8" class="seg-ico hot" /></div>
          <p v-if="!vm.hot.length" class="empty">暂无</p>
          <div v-for="(s, i) in vm.hot" :key="'h' + i" class="seg-row">
            <span class="seg-rank">{{ i + 1 }}</span><span class="seg-name">{{ s.name }}</span><b class="seg-count">{{ s.count }}</b>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>最多人停留的段（卡点）</h2><PauseCircle :size="16" :stroke-width="1.8" class="seg-ico stuck" /></div>
          <p v-if="!vm.stuck.length" class="empty">暂无</p>
          <div v-for="(s, i) in vm.stuck" :key="'s' + i" class="seg-row">
            <span class="seg-rank">{{ i + 1 }}</span><span class="seg-name">{{ s.name }}</span><b class="seg-count">{{ s.count }}</b>
          </div>
        </section>
      </div>
      <p v-if="vm.approxSeg" class="approx-note">热点/卡点为抽样估算（学员多时按样本近似·诚实标注）</p>

      <div class="panels">
        <section class="panel">
          <div class="panel-head"><h2>转化漏斗</h2><span class="panel-sub">下单 → 支付 → 激活</span></div>
          <div v-for="f in vm.funnel" :key="f.label" class="funnel-row">
            <span class="funnel-label">{{ f.label }}</span>
            <div class="funnel-track">
              <div class="funnel-bar" :style="{ width: (Number(f.value) / funnelMax) * 100 + '%' }" />
            </div>
            <span class="funnel-value">{{ f.value }}</span>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>最近动态</h2><span class="panel-sub">订单 · 激活 · 进课 · 退款</span></div>
          <p v-if="!vm.recent.length" class="empty">暂无动态</p>
          <div v-for="(e, i) in vm.recent" :key="i" class="act-row">
            <span class="act-type" :class="e.type">{{ ACT_LABEL[e.type] || e.type }}</span>
            <span class="act-text">{{ e.text }}</span>
            <span class="act-time">{{ fmtClock(e.at) }}</span>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 1160px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--ld-ink);
}
.sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content);
  font-size: 13px;
  cursor: pointer;
}
.btn-refresh:disabled {
  opacity: 0.6;
  cursor: default;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.status {
  font-size: 13px;
  color: var(--ld-content-2);
}
.alert {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  margin-bottom: 18px;
  background: var(--ld-bg-red-soft);
  border: 1px solid var(--ld-red-line);
  border-radius: var(--ld-radius-l);
}
.alert-ico {
  color: var(--ld-red);
  flex: none;
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
.alert-detail {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--ld-content);
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
.alert-item code {
  margin-left: 4px;
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
}
.btn-danger {
  flex: none;
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  background: var(--ld-red);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.ok-line {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--ld-green);
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}
.stat-card {
  padding: 18px 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stat-label {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.stat-ico {
  color: var(--ld-brand);
}
.stat-value {
  margin-top: 10px;
  font-size: 28px;
  font-weight: 700;
  color: var(--ld-ink);
  line-height: 1.1;
}
.stat-note {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 900px) {
  .panels {
    grid-template-columns: 1fr;
  }
}
.panel {
  padding: 18px 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
}
.panel-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
.panel-sub {
  font-size: 12px;
  color: var(--ld-content-2);
}
.panel-sub.link {
  cursor: pointer;
  color: var(--ld-brand);
  font-weight: 600;
}
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
.empty {
  font-size: 13px;
  color: var(--ld-content-2);
}
.order-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--ld-line);
}
.order-row:first-of-type {
  border-top: none;
}
.order-main {
  flex: 1;
  min-width: 0;
}
.order-summary {
  font-size: 13px;
  color: var(--ld-content);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.order-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.order-status {
  flex: none;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.order-status.warn {
  color: var(--ld-red);
}
.order-amount {
  flex: none;
  width: 84px;
  text-align: right;
  font-size: 13px;
  font-weight: 700;
  color: var(--ld-ink);
}
/* 待处理行动条 */
.todobar {
  padding: 16px 20px;
  margin-bottom: 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.todobar-head {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-content-2);
  margin-bottom: 12px;
}
.todos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.todo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--ld-line);
  border-radius: 12px;
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
  background: var(--ld-bg-lilac);
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
/* 段位分析 */
.seg-ico.hot {
  color: var(--ld-red);
}
.seg-ico.stuck {
  color: var(--ld-amber);
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
  margin: 0 0 18px;
  font-size: 11px;
  color: var(--ld-amber);
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
