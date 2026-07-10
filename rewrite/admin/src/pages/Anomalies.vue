<script setup lang="ts">
// 异常监测·bug 账本（design 语言一致·批3·治病根#14）：四路来源（服务端异常/不变量违反/关键流程失败/
// 客户端错误）统一账本·指纹去重（count 累加）·可筛未处理/已处理·标记已处理。数据走 adminApi listAnomalies/
// resolveAnomaly 真值。
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, Check, ClipboardList, AlertCircle, AlertTriangle, Activity, ShieldCheck } from 'lucide-vue-next'
import { listAnomalies, resolveAnomaly } from '../api/ops'
import { useLatest } from '../lib/latest'
import PageHeader from '../components/ui/PageHeader.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

// 会话失效导登录由 client.onSessionLost 集中处理（单源·根因#5）——本页不再自持 router
const list = ref<any[]>([])
const total = ref<number | null>(null) // 账本真实总数（N2·bug 清除战役 II 遗留）：与 list.length 分开——list 受 limit 截断，total 是同 filter 全量
const message = ref('加载中…')
const busy = ref(false)
const filter = ref<'open' | 'resolved' | 'all'>('open')

const KIND_LABEL: Record<string, string> = {
  'server-exception': '服务端异常',
  'invariant-violation': '不变量违反',
  'flow-failure': '关键流程失败',
  'client-error': '客户端错误',
}
const FILTERS: { key: 'open' | 'resolved' | 'all'; label: string }[] = [
  { key: 'open', label: '未处理' },
  { key: 'resolved', label: '已处理' },
  { key: 'all', label: '全部' },
]

function fmt(ms: number) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(ms)
  }
}
function ctxPairs(ctx: any): string {
  if (!ctx || typeof ctx !== 'object') return ''
  return Object.keys(ctx)
    .filter((k) => k !== 'fp')
    .map((k) => `${k}: ${ctx[k]}`)
    .join(' · ')
}

// KPI（纯展示·由当前加载的 list 真派生·不造无源指标）：本视图条数 / 未处理 / 高危 / 累计触发次数。
const openCount = computed(() => list.value.filter((a) => !a.resolved).length)
const highCount = computed(() => list.value.filter((a) => a.severity === 'high').length)
const totalHits = computed(() => list.value.reduce((s, a) => s + (Number(a.count) || 0), 0))

const listGen = useLatest() // 异常账本乱序守卫（P2·快切筛选时旧结果别覆盖当前 chip·根因#8）
async function load() {
  confirmId.value = '' // 换筛选/刷新即复位危险态（P1·防旧武装的「标记已处理」残留、重进同一位一击直发·批3 规格）
  busy.value = true
  const opts: { resolved?: boolean } = {}
  if (filter.value === 'open') opts.resolved = false
  else if (filter.value === 'resolved') opts.resolved = true
  const my = listGen.begin()
  const r: any = await listAnomalies(opts)
  busy.value = false
  if (listGen.isStale(my)) return // 已切别 chip·丢弃过期异常账本
  if (r.error === 'SESSION_LOST') return // 会话失效集中导登录（client.onSessionLost·单源·根因#5）
  list.value = r.list || []
  total.value = typeof r.total === 'number' ? r.total : null
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

const confirmId = ref('') // 两步确认（换皮一键无撤销·标记已处理是破坏性动作）
async function markResolved(a: any) {
  if (confirmId.value !== a._id) {
    confirmId.value = a._id
    return
  }
  confirmId.value = ''
  const r: any = await resolveAnomaly(a._id)
  if (r.error === 'SESSION_LOST') return // 会话失效集中导登录（client.onSessionLost·单源·根因#5）
  if (r.ok) {
    await load()
    return
  }
  // 破坏性动作失败（网络/未生效）必须显——否则两步确认按钮悄悄复位、异常仍未处理、操作员以为已办（病根#14）
  message.value = '标记失败：' + String(r.error || '未生效，请重试') // 不 reload（reload 成功会把此错抹掉）
}

function setFilter(f: 'open' | 'resolved' | 'all') {
  filter.value = f
  void load()
}

onMounted(load)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="异常监测" sub="运行期异常与告警账本 · 同类去重（次数累加）· 高危 [LD_ALERT] 单出口实时推企微">
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="load">
        <RefreshCw :size="14" :stroke-width="1.8" :class="{ spin: busy }" />
        <span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </UiButton>
    </PageHeader>

    <!-- 级别/状态筛选（沿用 FILTERS open/resolved/all·服务端筛选） -->
    <div class="ld-toolbar">
      <button v-for="f in FILTERS" :key="f.key" class="ld-chip" :class="{ on: filter === f.key }" @click="setFilter(f.key)">
        {{ f.label }}
      </button>
    </div>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <template v-if="list.length">
      <!-- KPI×4：全部为当前视图 list 真派生的 count（不造 今日新增/平均处理 等无源指标） -->
      <div class="ld-kpi-grid">
        <KpiCard label="本视图条数" :value="list.length" :icon="ClipboardList" />
        <KpiCard label="未处理" :value="openCount" :icon="AlertCircle" :tone="openCount > 0 ? 'red' : 'neutral'" />
        <KpiCard label="高危" :value="highCount" :icon="AlertTriangle" :tone="highCount > 0 ? 'red' : 'neutral'" />
        <KpiCard label="累计触发" :value="totalHits" :icon="Activity" />
      </div>

      <!-- 账本总数提示（N2·仅当总数超出本视图截断条数时显示，不动既有 4 张 KPI 卡布局） -->
      <p v-if="total != null && total > list.length" class="ld-status">
        账本共 {{ total }} 条 · 本视图按 lastSeen 前 {{ list.length }} 条（处理后重载会顶上更早的）
      </p>

      <!-- 异常账本（行卡·级别条 + kind/code/高危/次数 徽章 + ctx + meta + 两步确认标记已处理） -->
      <div class="ledger">
        <article v-for="a in list" :key="a._id" class="row" :class="{ done: a.resolved }">
          <span class="sev" :class="{ high: a.severity === 'high' }" />
          <div class="body">
            <div class="row-top">
              <Badge tone="brand">{{ KIND_LABEL[a.kind] || a.kind }}</Badge>
              <code class="code">{{ a.code }}</code>
              <Badge v-if="a.severity === 'high'" tone="red">高危</Badge>
              <Badge v-if="a.count > 1" tone="amber">×{{ a.count }}</Badge>
            </div>
            <div v-if="ctxPairs(a.ctx)" class="ctx">{{ ctxPairs(a.ctx) }}</div>
            <div class="meta">最近 {{ fmt(a.lastSeen) }}<span v-if="a.resolved && a.resolvedBy"> · 处理人 {{ a.resolvedBy }}</span></div>
          </div>
          <div class="row-act">
            <UiButton
              v-if="!a.resolved"
              :variant="confirmId === a._id ? 'primary' : 'ghost'"
              size="sm"
              @click="markResolved(a)"
            >
              <Check :size="14" :stroke-width="2" />
              <span>{{ confirmId === a._id ? '确认已处理？' : '标记已处理' }}</span>
            </UiButton>
            <Badge v-else tone="green" dot>已处理</Badge>
          </div>
        </article>
      </div>
    </template>

    <EmptyState v-else-if="!message" :icon="ShieldCheck" :text="filter === 'open' ? '没有未处理异常' : '暂无记录'" />
  </div>
</template>

<style scoped>
/* 异常账本行卡（本页独有·容器/工具条/KPI/徽章/按钮走 kit 与 console.css） */
.ledger {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  align-items: stretch;
  gap: 14px;
  padding: 14px 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
}
.row.done {
  opacity: 0.6;
}
.sev {
  width: 4px;
  border-radius: 999px;
  flex: none;
  background: var(--ld-line-strong);
}
.sev.high {
  background: var(--ld-red);
}
.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.code {
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ld-ink);
}
.ctx {
  font-size: 12px;
  color: var(--ld-content);
  font-family: var(--ld-font-mono);
  word-break: break-all;
}
.meta {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.row-act {
  flex: none;
  align-self: center;
  display: flex;
  align-items: center;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
