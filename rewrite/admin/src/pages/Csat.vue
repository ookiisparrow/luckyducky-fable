<script setup lang="ts">
// 客服满意度（设计语言一致性·M3 UI 批15 + 明细钻取批 B6）：均分 + 星级分布 + 带备注数（越界分云端已剔）。
// 不编数（根因#8·T3）：mapCsat 只给 avg/total/withNote/dist——设计稿的「坐席排名」「区间对比」无数据源，一律不建。
// 好评率/差评数从 dist 派生（真·非造）。
// 明细钻取（批 B6）：listCsatEntries 真数据——时间 chips（近7天/近30天/全部）+「仅差评 ≤3」开关 + 明细表
// （时间/评分/备注/定位键）+ 翻页照 Conversations.vue 模式（useLatest 乱序守卫·根因#8）+ 差评行「查会话」
// 跳 Conversations 页带 externalUserId 预填（该页新增最小 query 预填能力，见 Conversations.vue）。
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { RotateCcw, Star, ThumbsUp, ThumbsDown, MessageSquare, Search } from 'lucide-vue-next'
import { getCsatReport, listCsatEntries } from '../api/cs'
import { mapCsat, mapCsatEntries, type CsatEntryVM } from '../lib/mapCs'
import { useLatest } from '../lib/latest'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

const router = useRouter()

const vm = ref<ReturnType<typeof mapCsat>>(null)
const message = ref('加载中…')
const busy = ref(false)

// 派生纯展示（真·非造）：好评＝4–5 星、差评＝1–2 星，按 star 文案解析档位后求和
const badCount = computed(() => (vm.value?.dist || []).filter((d) => parseInt(d.star) <= 2).reduce((s, d) => s + d.n, 0))
const goodRate = computed(() => {
  const t = vm.value?.total || 0
  if (!t) return '0%'
  const good = (vm.value?.dist || []).filter((d) => parseInt(d.star) >= 4).reduce((s, d) => s + d.n, 0)
  return Math.round((good / t) * 1000) / 10 + '%'
})

async function load() {
  busy.value = true
  const r = await getCsatReport()
  busy.value = false
  vm.value = mapCsat(r)
  message.value = vm.value ? '' : '加载失败：' + String(r.error || '')
}

// —— 明细钻取（批 B6）——
const RANGE_CHIPS = [
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '30d', label: '近 30 天', days: 30 },
  { key: 'all', label: '全部', days: 0 },
] as const
type RangeKey = (typeof RANGE_CHIPS)[number]['key']
const range = ref<RangeKey>('7d')
const badOnly = ref(false) // 仅差评 ≤2（P2 顺手改批：统一到 badCount/KPI 卡同口径——1~2 星差评/3 星中评/4~5 星好评，此前筛选按钮按 ≤3 与 KPI 卡 ≤2 打架）

const entries = ref<CsatEntryVM[]>([])
const entriesCursor = ref<unknown>(null)
const entriesHasMore = ref(false)
const entriesMsg = ref('')
const entriesBusy = ref(false)
// 发起检索时的筛选快照（翻页复用·防切区间后翻页串档·同 Conversations.vue searchFilter 范式）
let entriesFilter: { from?: number; to?: number; maxScore?: number } = {}
const entriesGen = useLatest() // 乱序守卫（切区间/翻页在途时又切·旧结果别覆盖新结果）

function currentRangeArgs(): { from?: number; to?: number } {
  const chip = RANGE_CHIPS.find((c) => c.key === range.value)
  if (!chip || !chip.days) return {} // 全部＝不设窗
  const now = Date.now()
  return { from: now - chip.days * 86400_000, to: now }
}

async function loadEntries() {
  entriesMsg.value = '加载中…'
  entriesBusy.value = true
  const { from, to } = currentRangeArgs()
  entriesFilter = { from, to, maxScore: badOnly.value ? 2 : undefined }
  const my = entriesGen.begin()
  const r = await listCsatEntries(entriesFilter)
  if (entriesGen.isStale(my)) return // 期间又切区间/开关·丢弃过期结果
  entriesBusy.value = false
  entries.value = r.ok ? mapCsatEntries(r.entries) : []
  entriesCursor.value = r.ok ? r.nextCursor : null
  entriesHasMore.value = !!(r.ok && r.hasMore)
  entriesMsg.value = r.ok ? (entries.value.length ? '' : '这个区间没有评价') : '加载失败：' + String(r.error || '')
}

async function moreEntries() {
  if (!entriesHasMore.value || entriesCursor.value == null) return
  if (entriesBusy.value) return // 主查询在途时不翻页（cursor 还是旧的）
  const gen = entriesGen.peek() // 绑定当前主查询代际·不递增（不反噬在途主查询）
  const r = await listCsatEntries({ ...entriesFilter, cursor: entriesCursor.value })
  if (entriesGen.isStale(gen)) return // 期间又切区间·放弃本页
  if (!r.ok) {
    entriesMsg.value = '加载更多失败：' + String(r.error || '')
    return
  }
  entriesMsg.value = ''
  const seen = new Set(entries.value.map((e) => e.id)) // 去重·防双击「加载更多」重复追加同一页（同 Orders/Refunds/Conversations 范式）
  entries.value = [...entries.value, ...mapCsatEntries(r.entries).filter((e) => !seen.has(e.id))]
  entriesCursor.value = r.nextCursor
  entriesHasMore.value = !!r.hasMore
}

function pickRange(k: RangeKey) {
  if (range.value === k) return
  range.value = k
  void loadEntries()
}
function toggleBadOnly() {
  badOnly.value = !badOnly.value
  void loadEntries()
}
function viewSession(row: CsatEntryVM) {
  if (!row.sessionKey) return
  void router.push({ path: '/conversations', query: { externalUserId: row.sessionKey } })
}

onMounted(() => {
  void load()
  void loadEntries()
})
</script>

<template>
  <div class="ld-page">
    <PageHeader title="客服满意度" sub="均分 + 星级分布 + 带备注数（越界分云端已剔除，只统计有效评分）。">
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="load">
        <RotateCcw :size="14" :stroke-width="1.8" /><span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <EmptyState v-else-if="vm && !vm.total" :icon="Star" text="还没有顾客评价——顾客在客服会话里点 ⭐ 评价后出现在这里。" />

    <template v-else-if="vm && vm.total">
      <div class="ld-kpi-grid">
        <KpiCard label="CSAT 均分" :value="vm.avg" :icon="Star">
          <span class="kpi-note">满分 5 分</span>
        </KpiCard>
        <KpiCard label="好评率" :value="goodRate" :icon="ThumbsUp">
          <span class="kpi-note">满意 + 非常满意（4–5 星）占比</span>
        </KpiCard>
        <KpiCard label="参评量" :value="vm.total" :icon="MessageSquare">
          <span class="kpi-note">其中 {{ vm.withNote }} 条带备注</span>
        </KpiCard>
        <KpiCard label="差评数" :value="badCount" :icon="ThumbsDown" tone="red">
          <span class="kpi-note">1–2 星评价</span>
        </KpiCard>
      </div>

      <Card title="评分分布" sub="按星级统计有效评分（越界分云端已剔除）">
        <div v-if="vm.approxNote" class="dist-approx"><Badge tone="amber">{{ vm.approxNote }}</Badge></div>
        <div class="dist">
          <div v-for="d in vm.dist" :key="d.star" class="dist-row">
            <span class="star">{{ d.star }}</span>
            <div class="bar"><div class="fill" :style="{ width: vm.total ? (d.n / vm.total) * 100 + '%' : '0' }" /></div>
            <span class="n">{{ d.n }}<em class="pct">{{ vm.total ? Math.round((d.n / vm.total) * 100) : 0 }}%</em></span>
          </div>
        </div>
      </Card>
    </template>

    <!-- 明细钻取（批 B6）：无「暂无评价」也展示（区间/开关可换），故不依赖上方 vm.total 门控 -->
    <Card title="评价明细" sub="按时间窗 + 评分筛选逐条查看；差评行可一键跳会话时间轴取证">
      <template #head>
        <div class="range-chips">
          <UiButton
            v-for="c in RANGE_CHIPS"
            :key="c.key"
            size="sm"
            :variant="range === c.key ? 'primary' : 'ghost'"
            @click="pickRange(c.key)"
          >{{ c.label }}</UiButton>
          <UiButton size="sm" :variant="badOnly ? 'primary' : 'ghost'" @click="toggleBadOnly">仅差评 ≤2</UiButton>
        </div>
        <UiButton variant="ghost" size="sm" :disabled="entriesBusy" @click="loadEntries">
          <RotateCcw :size="14" :stroke-width="1.8" /><span>{{ entriesBusy ? '刷新中…' : '刷新' }}</span>
        </UiButton>
      </template>

      <p v-if="entriesMsg" class="ld-status">{{ entriesMsg }}</p>
      <div v-if="entries.length" class="ld-table">
        <div class="ld-thead">
          <div class="ld-th" :style="{ width: '170px' }">时间</div>
          <div class="ld-th" :style="{ width: '80px' }">评分</div>
          <div class="ld-th grow">备注</div>
          <div class="ld-th" :style="{ width: '150px' }">定位键</div>
          <div class="ld-th ops-cell" :style="{ width: '110px' }">操作</div>
        </div>
        <div class="ld-tbody">
          <div v-for="row in entries" :key="row.id" class="ld-tr" :class="{ bad: row.bad }">
            <div class="ld-td muted mono" :style="{ width: '170px' }">{{ row.timeLabel }}</div>
            <div class="ld-td" :style="{ width: '80px' }">
              <Badge :tone="row.bad ? 'red' : 'green'">{{ row.score }} 分</Badge>
            </div>
            <div class="ld-td grow">{{ row.note }}</div>
            <div class="ld-td mono" :style="{ width: '150px' }">{{ row.sessionKey || '—' }}</div>
            <div class="ld-td ops-cell" :style="{ width: '110px' }">
              <UiButton v-if="row.bad && row.sessionKey" variant="ghost" size="sm" @click="viewSession(row)">
                <Search :size="13" :stroke-width="1.8" /><span>查会话</span>
              </UiButton>
            </div>
          </div>
        </div>
        <div class="more-wrap">
          <UiButton v-if="entriesHasMore" size="sm" variant="ghost" @click="moreEntries">加载更多</UiButton>
          <p v-else class="end-mark">— 已到最早 —</p>
        </div>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.kpi-note {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.dist-approx {
  margin-bottom: 12px;
}
.dist-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 0;
}
.star {
  width: 40px;
  flex: none;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.bar {
  flex: 1;
  height: 10px;
  background: var(--ld-bg-faint);
  border-radius: 999px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--ld-brand);
  border-radius: 999px;
}
.n {
  width: 78px;
  flex: none;
  text-align: right;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-ink);
}
.pct {
  margin-left: 6px;
  font-style: normal;
  font-weight: 400;
  font-size: 11px;
  color: var(--ld-content-2);
}

/* 明细钻取（批 B6）：时间/差评筛选 chips · 表格辅助类（scoped 边界铁律·组件间互不共享·同 Agents/Conversations 各自定义） */
.range-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
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
.ops-cell {
  justify-content: flex-end;
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
