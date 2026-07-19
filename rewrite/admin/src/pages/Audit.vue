<script setup lang="ts">
// 审计日志（批 B6·操作审计#4 读出口）：谁在何时做了什么操作——kit/audit.ts::recordAudit 已全量写 auditLog，
// 此前唯一读路径是控制台裸翻数据库，本页补读出口。敏感字段（口令/webhook）已在写侧 summarize 剥离
// （见 kit/audit.ts），本页展示 summary 原样透传即安全。仅超管可查（未登记 ACTION_CAPS→默认拒 admin:write）。
// 分页/翻页/乱序守卫照 Csat.vue「评价明细」样板（cursor 翻页 + dedupe-by-id + useLatest）；不编数（根因#8·T3）：
// 两张 KPI 卡纯从当前视图 entries 派生，同 Anomalies.vue「本视图条数」精神。
import { ref, computed, onMounted } from 'vue'
import { RotateCcw, Search, ClipboardList, AlertCircle, ShieldCheck } from 'lucide-vue-next'
import { listAudit } from '../api/ops'
import { mapAuditEntries, type AuditEntryVM } from '../lib/mapSystem'
import { useLatest } from '../lib/latest'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

const RANGE_CHIPS = [
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '30d', label: '近 30 天', days: 30 },
  { key: 'all', label: '全部', days: 0 },
] as const
type RangeKey = (typeof RANGE_CHIPS)[number]['key']
const range = ref<RangeKey>('7d')

// 自由文本筛选不用 chip 自动触发（避免击键抖动请求）——「筛选」按钮/回车才发起
const operatorInput = ref('')
const actionPrefixInput = ref('')

const entries = ref<AuditEntryVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const message = ref('加载中…')
const busy = ref(false)
// 发起检索时的筛选快照（翻页复用·防切筛选后翻页串档·同 Conversations.vue searchFilter 范式）
let filterSnapshot: { operator?: string; actionPrefix?: string; from?: number; to?: number } = {}
const gen = useLatest() // 乱序守卫（切筛选/翻页在途时又切·旧结果别覆盖新结果）

const failCount = computed(() => entries.value.filter((e) => !e.ok).length)

function currentRangeArgs(): { from?: number; to?: number } {
  const chip = RANGE_CHIPS.find((c) => c.key === range.value)
  if (!chip || !chip.days) return {} // 全部＝不设窗
  const now = Date.now()
  return { from: now - chip.days * 86400_000, to: now }
}

async function load() {
  message.value = '加载中…'
  busy.value = true
  const { from, to } = currentRangeArgs()
  filterSnapshot = {
    operator: operatorInput.value.trim() || undefined,
    actionPrefix: actionPrefixInput.value.trim() || undefined,
    from,
    to,
  }
  const my = gen.begin()
  const r = await listAudit(filterSnapshot)
  if (gen.isStale(my)) return // 期间又切筛选·丢弃过期结果
  busy.value = false
  entries.value = r.ok ? mapAuditEntries(r.entries) : []
  cursor.value = r.ok ? r.nextCursor : null
  hasMore.value = !!(r.ok && r.hasMore)
  if (!r.ok) message.value = '加载失败：' + String(r.error || '')
  // actionPrefix 页内过滤可能使本页命中为空、但后面页仍有匹配（hasMore 不受 actionPrefix 影响）——
  // 不能笼统说「没有更多了」，须允许「本页无匹配，可继续翻」的语义（云端 listAudit 头注同一处说明）。
  else if (entries.value.length) message.value = ''
  else message.value = hasMore.value ? '本页无匹配，点“加载更多”继续翻' : '没有匹配的记录'
}

async function more() {
  if (!hasMore.value || cursor.value == null) return
  if (busy.value) return // 主查询在途时不翻页（cursor 还是旧的）
  const g = gen.peek() // 绑定当前主查询代际·不递增（不反噬在途主查询）
  const r = await listAudit({ ...filterSnapshot, cursor: cursor.value })
  if (gen.isStale(g)) return // 期间又切筛选·放弃本页
  if (!r.ok) {
    message.value = '加载更多失败：' + String(r.error || '')
    return
  }
  const seen = new Set(entries.value.map((e) => e.id)) // 去重·防双击「加载更多」重复追加同一页
  const appended = mapAuditEntries(r.entries).filter((e) => !seen.has(e.id))
  entries.value = [...entries.value, ...appended]
  cursor.value = r.nextCursor
  hasMore.value = !!r.hasMore
  message.value = entries.value.length ? '' : hasMore.value ? '本页无匹配，点“加载更多”继续翻' : '没有匹配的记录'
}

function pickRange(k: RangeKey) {
  if (range.value === k) return
  range.value = k
  void load()
}

onMounted(load)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="审计日志" sub="谁在何时做了什么操作 · 敏感字段已在写侧剥离 · 仅超管可查">
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="load">
        <RotateCcw :size="14" :stroke-width="1.8" /><span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </UiButton>
    </PageHeader>

    <div class="ld-kpi-grid">
      <KpiCard label="本视图条数" :value="entries.length" :icon="ClipboardList" />
      <KpiCard label="失败次数" :value="failCount" :icon="AlertCircle" :tone="failCount > 0 ? 'red' : 'neutral'" />
    </div>

    <Card title="操作记录" sub="按时间倒序 · 可按操作人 / action 前缀 / 时间窗筛选">
      <template #head>
        <div class="range-chips">
          <UiButton
            v-for="c in RANGE_CHIPS"
            :key="c.key"
            size="sm"
            :variant="range === c.key ? 'primary' : 'ghost'"
            @click="pickRange(c.key)"
          >{{ c.label }}</UiButton>
        </div>
      </template>

      <div class="ld-toolbar audit-filter">
        <label class="ld-search"><input v-model="operatorInput" placeholder="操作人（精确匹配）" @keyup.enter="load" /></label>
        <label class="ld-search"><input v-model="actionPrefixInput" placeholder="action 前缀（如 save）" @keyup.enter="load" /></label>
        <UiButton size="sm" @click="load">
          <Search :size="14" :stroke-width="1.8" /><span>筛选</span>
        </UiButton>
      </div>

      <p v-if="message" class="ld-status">{{ message }}</p>
      <div v-if="entries.length" class="ld-table">
        <div class="ld-thead">
          <div class="ld-th" :style="{ width: '160px' }">时间</div>
          <div class="ld-th" :style="{ width: '110px' }">操作人</div>
          <div class="ld-th" :style="{ width: '150px' }">action</div>
          <div class="ld-th" :style="{ width: '120px' }">状态</div>
          <div class="ld-th" :style="{ width: '120px' }">IP</div>
          <div class="ld-th grow">摘要</div>
        </div>
        <div class="ld-tbody">
          <div v-for="row in entries" :key="row.id" class="ld-tr" :class="{ bad: !row.ok }">
            <div class="ld-td muted mono" :style="{ width: '160px' }">{{ row.timeLabel }}</div>
            <div class="ld-td" :style="{ width: '110px' }">{{ row.operator }}</div>
            <div class="ld-td mono" :style="{ width: '150px' }">{{ row.action }}</div>
            <div class="ld-td" :style="{ width: '120px' }">
              <Badge :tone="row.ok ? 'green' : 'red'">{{ row.statusLabel }}</Badge>
              <div v-if="!row.ok && row.error" class="err-note">{{ row.error }}</div>
            </div>
            <div class="ld-td mono" :style="{ width: '120px' }">{{ row.ip }}</div>
            <div class="ld-td grow">{{ row.summaryText }}</div>
          </div>
        </div>
        <div class="more-wrap">
          <UiButton v-if="hasMore" size="sm" variant="ghost" @click="more">加载更多</UiButton>
          <p v-else class="end-mark">— 已到最早 —</p>
        </div>
      </div>
      <EmptyState v-else-if="!message" :icon="ShieldCheck" text="还没有操作记录" />
    </Card>
  </div>
</template>

<style scoped>
.range-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.audit-filter {
  margin-bottom: 12px;
}
.mono {
  font-family: var(--ld-font-mono);
  font-size: 12px;
  color: var(--ld-content-2);
}
.muted {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.err-note {
  margin-top: 3px;
  font-size: 11px;
  color: var(--ld-red);
}
.ld-tr.bad {
  background: var(--ld-bg-red-soft);
}
.more-wrap {
  display: flex;
  justify-content: center;
  margin-top: 6px;
}
.end-mark {
  width: 100%;
  margin: 6px 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--ld-content-2);
}
</style>
