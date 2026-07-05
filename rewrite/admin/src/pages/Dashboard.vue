<script setup lang="ts">
// 数据看板（design/console.pen S12 视觉·M3 UI 批2）：交易异常横幅（有则必显）+ 经营统计卡（真数据）
// + 转化漏斗 + 最近订单。设计稿的趋势%/迷你柱/热点卡点段位分析当前后端无数据源——不编数，
// 留待独立学习分析 action（记 docs/待办与债.md），本页只渲染 getDashboard/listOrders 真值。
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Users, ShoppingBag, Wallet, QrCode, GraduationCap, RefreshCw, TriangleAlert } from 'lucide-vue-next'
import { getDashboard, listOrders } from '../api/money'
import { mapDashboard, mapOrderRows, type OrderRowVM } from '../lib/mapMoney'

const router = useRouter()
const vm = ref<ReturnType<typeof mapDashboard>>(null)
const orders = ref<OrderRowVM[]>([])
const message = ref('加载中…')
const busy = ref(false)

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
  const [d, o] = await Promise.all([getDashboard(), listOrders(undefined, undefined, 6)])
  busy.value = false
  if ((d as any).error === 'SESSION_LOST' || (o as any).error === 'SESSION_LOST') {
    void router.push('/login')
    return
  }
  vm.value = mapDashboard(d)
  orders.value = mapOrderRows((o as any)?.list)
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
      <p v-else class="ok-line">钱链无异常单 ✓</p>

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
          <div class="panel-head"><h2>最近订单</h2><span class="panel-sub link" @click="router.push('/orders')">查看全部 →</span></div>
          <p v-if="!orders.length" class="empty">暂无订单</p>
          <div v-for="o in orders" :key="o.id" class="order-row">
            <div class="order-main">
              <div class="order-summary">{{ o.summary || o.id }}</div>
              <div class="order-meta">{{ o.id }} · {{ o.timeLabel }}</div>
            </div>
            <span class="order-status" :class="{ warn: o.feeMismatch }">{{ o.statusLabel }}</span>
            <span class="order-amount">{{ o.amountLabel }}</span>
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
</style>
