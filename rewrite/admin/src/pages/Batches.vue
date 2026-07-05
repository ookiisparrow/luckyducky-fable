<script setup lang="ts">
// 激活码批次（design/console.pen S9 视觉 + 批次详情抽屉·M3 UI 批6）：统计卡/进度条/状态 chip 由真聚合派生、
// 详情抽屉码表接 listBatchCodes 真码 + CSV 导出（客户端真生成）。
// 诚实边界：后端 listBatches 需 courseId（无「列全量批次」action）——按课程范围查（非跨课「全部」）；
// listBatchCodes 只回码串无每码激活态——码表不标单码已激活/未用（记待办）；印刷包 ZIP/二维码图导出属旧台待补（记待办）。
import { ref, computed } from 'vue'
import { Layers, QrCode, CircleCheck, TrendingUp, X, Download } from 'lucide-vue-next'
import { listBatches, createBatch, listBatchCodes } from '../api/system'
import { mapBatches, type BatchRow } from '../lib/mapSystem'

const courseId = ref('')
const loadedCourse = ref('')
const rows = ref<BatchRow[]>([])
const message = ref('')
const busy = ref(false)
const count = ref(50)
const creating = ref(false)
const search = ref('')
const filter = ref<'all' | 'using' | 'used' | 'fresh'>('all')

const detail = ref<BatchRow | null>(null)
const codes = ref<string[]>([])
const codesLoading = ref(false)

function statusOf(b: BatchRow): 'using' | 'used' | 'fresh' {
  if (b.activated <= 0) return 'fresh'
  if (b.total > 0 && b.activated >= b.total) return 'used'
  return 'using'
}
const STATUS_LABEL = { using: '使用中', used: '已用尽', fresh: '全新' }
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'using', label: '使用中' },
  { key: 'used', label: '已用尽' },
  { key: 'fresh', label: '全新' },
] as const

const stats = computed(() => {
  const totalCodes = rows.value.reduce((s, b) => s + b.total, 0)
  const activated = rows.value.reduce((s, b) => s + b.activated, 0)
  return {
    batches: rows.value.length,
    codes: totalCodes,
    activated,
    rate: totalCodes ? Math.round((activated / totalCodes) * 100) + '%' : '—',
  }
})
const counts = computed(() => ({
  all: rows.value.length,
  using: rows.value.filter((b) => statusOf(b) === 'using').length,
  used: rows.value.filter((b) => statusOf(b) === 'used').length,
  fresh: rows.value.filter((b) => statusOf(b) === 'fresh').length,
}))
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter(
    (b) => (filter.value === 'all' || statusOf(b) === filter.value) && (!q || b.batchId.toLowerCase().includes(q))
  )
})
const pct = (b: BatchRow) => (b.total ? Math.min(100, Math.round((b.activated / b.total) * 100)) : 0)

async function load() {
  const c = courseId.value.trim()
  if (!c) return
  message.value = '加载中…'
  const r = await listBatches(c)
  rows.value = r.ok ? mapBatches(r.list) : []
  loadedCourse.value = r.ok ? c : ''
  message.value = r.ok ? (rows.value.length ? '' : '这门课还没有批次') : '加载失败：' + String(r.error || '')
}

async function doCreate() {
  if (busy.value) return
  if (!Number.isInteger(count.value) || count.value < 1) {
    message.value = '数量要是正整数（≤500）'
    return
  }
  busy.value = true
  const r = await createBatch(courseId.value.trim(), count.value)
  busy.value = false
  message.value = r.ok ? `已生成批次 ${String(r.batchId)}（${(r.codes as string[]).length} 张码）` : '生成失败：' + String(r.error || '')
  creating.value = false
  void load()
}

async function openDetail(b: BatchRow) {
  detail.value = b
  codes.value = []
  codesLoading.value = true
  const r = await listBatchCodes(b.batchId)
  codes.value = r.ok ? (r.codes as string[]) : []
  codesLoading.value = false
}
function closeDetail() {
  detail.value = null
}
function exportCsv() {
  if (!detail.value || !codes.value.length) return
  const csv = '激活码\n' + codes.value.join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = detail.value.batchId + '-codes.csv'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>二维码批次</h1>
        <p class="sub">激活卡批次的生成 · 印刷打包 · 激活追踪——一码一地址、一码一用</p>
      </div>
      <button class="btn-primary" :disabled="!loadedCourse" @click="creating = !creating">＋ 生成新批次</button>
    </header>

    <div v-if="creating" class="create-bar">
      <span>为课程 <b>{{ loadedCourse }}</b> 生成</span>
      <input v-model.number="count" type="number" min="1" max="500" />
      <span>张码</span>
      <button class="act" :disabled="busy" @click="doCreate">确认生成</button>
      <button class="act ghost" @click="creating = false">取消</button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-head"><span class="stat-label">批次总数</span><Layers class="stat-ico" :size="18" :stroke-width="1.8" /></div>
        <div class="stat-value">{{ stats.batches }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><span class="stat-label">码总量</span><QrCode class="stat-ico" :size="18" :stroke-width="1.8" /></div>
        <div class="stat-value">{{ stats.codes.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><span class="stat-label">已激活</span><CircleCheck class="stat-ico" :size="18" :stroke-width="1.8" /></div>
        <div class="stat-value">{{ stats.activated.toLocaleString() }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><span class="stat-label">平均激活率</span><TrendingUp class="stat-ico" :size="18" :stroke-width="1.8" /></div>
        <div class="stat-value">{{ stats.rate }}</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="chips">
        <button v-for="f in FILTERS" :key="f.key" class="chip" :class="{ on: filter === f.key }" @click="filter = f.key">
          {{ f.label }}<span class="chip-n">{{ counts[f.key] }}</span>
        </button>
      </div>
      <div class="course-picker">
        <input v-model="courseId" placeholder="course-xxx" @keyup.enter="load" />
        <button class="act ghost" @click="load">载入课程</button>
      </div>
    </div>
    <p class="note">后端按课程查批次（一码一地址）；先输入课程编号载入，统计卡与筛选为该课程范围。</p>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="shown.length" class="table">
      <div class="thead">
        <span>批次号</span>
        <span>生成时间</span>
        <span class="r">数量</span>
        <span>激活进度</span>
        <span>状态</span>
        <span class="r">操作</span>
      </div>
      <div v-for="b in shown" :key="b.batchId" class="trow">
        <span class="bid">{{ b.batchId }}</span>
        <span class="time">{{ b.createdAt }}</span>
        <span class="qty r">{{ b.total }}</span>
        <div class="prog">
          <div class="prog-text">{{ b.activated }} / {{ b.total }} · {{ b.rateLabel }}</div>
          <div class="prog-track"><div class="prog-bar" :class="statusOf(b)" :style="{ width: pct(b) + '%' }" /></div>
        </div>
        <span class="c-state"><span class="state" :class="statusOf(b)">{{ STATUS_LABEL[statusOf(b)] }}</span></span>
        <div class="c-ops r">
          <button class="act ghost" @click="openDetail(b)">详情 / 看码</button>
        </div>
      </div>
      <div class="tfoot">已加载 {{ rows.length }} 批次（课程 {{ loadedCourse }}）</div>
    </div>
    <p v-else-if="!message && loadedCourse" class="status-soft">没有符合筛选的批次</p>
    <p v-else-if="!loadedCourse" class="status-soft">输入课程编号（course-xxx）载入其激活码批次</p>

    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">批次详情</div>
            <div class="drawer-bid">{{ detail.batchId }}</div>
          </div>
          <button class="drawer-close" @click="closeDetail"><X :size="16" :stroke-width="1.8" /></button>
        </div>

        <div class="info">
          <div class="irow"><span>所属课程</span><strong>{{ loadedCourse }}</strong></div>
          <div class="irow"><span>生成时间</span><strong>{{ detail.createdAt }}</strong></div>
          <div class="irow"><span>数量</span><strong>{{ detail.total }} 个</strong></div>
          <div class="prog-block">
            <div class="irow"><span>已激活</span><strong class="rate">{{ detail.activated }} / {{ detail.total }} · {{ detail.rateLabel }}</strong></div>
            <div class="prog-track"><div class="prog-bar using" :style="{ width: pct(detail) + '%' }" /></div>
          </div>
        </div>

        <div class="codes-head">
          <span class="codes-title">激活码 · {{ detail.total }}</span>
          <button class="export" :disabled="!codes.length" @click="exportCsv">
            <Download :size="13" :stroke-width="1.8" /><span>导出 CSV</span>
          </button>
        </div>
        <p class="codes-note">码表为批次全部激活码（一码一地址）；单码「已激活/未用」状态后端暂未随码返回，看整体激活率。</p>
        <div class="code-list">
          <p v-if="codesLoading" class="code-loading">取码中…</p>
          <p v-else-if="!codes.length" class="code-loading">无码</p>
          <div v-for="c in codes.slice(0, 100)" :key="c" class="code-row">{{ c }}</div>
          <div v-if="codes.length > 100" class="code-more">…共 {{ codes.length }} 个，导出 CSV 查看全部</div>
        </div>
      </aside>
    </div>
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
  margin-bottom: 18px;
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
.btn-primary {
  flex: none;
  padding: 10px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.4;
}
.create-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: var(--ld-bg-lilac);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  font-size: 13px;
  color: var(--ld-content);
}
.create-bar input {
  width: 90px;
  padding: 7px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 8px;
  font-size: 13px;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 6px;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 13px;
  cursor: pointer;
}
.chip.on {
  background: var(--ld-purple-ink);
  border-color: var(--ld-purple-ink);
  color: #fff;
}
.chip-n {
  opacity: 0.7;
}
.course-picker {
  display: flex;
  gap: 8px;
}
.course-picker input {
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  font-size: 13px;
  min-width: 160px;
}
.note {
  margin: 0 0 14px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.table {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 1.5fr 1.1fr 0.7fr 2fr 0.9fr 1.2fr;
  align-items: center;
  gap: 12px;
  padding: 13px 20px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
}
.r {
  text-align: right;
  justify-self: end;
}
.bid {
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
  color: var(--ld-ink);
}
.time {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.qty {
  color: var(--ld-content);
}
.prog {
  min-width: 0;
}
.prog-text {
  font-size: 11.5px;
  color: var(--ld-content-2);
  margin-bottom: 5px;
}
.prog-track {
  height: 7px;
  background: var(--ld-bg-faint);
  border-radius: 999px;
  overflow: hidden;
}
.prog-bar {
  height: 100%;
  border-radius: 999px;
  background: var(--ld-brand);
}
.prog-bar.used {
  background: var(--ld-green);
}
.prog-bar.fresh {
  background: var(--ld-line-strong);
}
.state {
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 11.5px;
  white-space: nowrap;
}
.state.using {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
}
.state.used {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.state.fresh {
  background: var(--ld-bg-faint);
  color: var(--ld-content-2);
}
.c-ops {
  display: flex;
}
.act {
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.act.ghost {
  background: var(--ld-bg);
  color: var(--ld-content-2);
  border: 1px solid var(--ld-line);
}
.act:disabled {
  opacity: 0.5;
}
.tfoot {
  padding: 12px 20px;
  border-top: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}
/* 批次详情抽屉 */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 15, 30, 0.28);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}
.drawer {
  width: 400px;
  max-width: 94vw;
  height: 100%;
  background: var(--ld-bg);
  border-left: 1px solid var(--ld-line);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  animation: slidein 0.18s ease;
}
@keyframes slidein {
  from {
    transform: translateX(24px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.drawer-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--ld-ink);
}
.drawer-bid {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.drawer-close {
  display: flex;
  padding: 6px;
  border: none;
  border-radius: 8px;
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
  cursor: pointer;
}
.info {
  padding: 14px;
  background: var(--ld-bg-lilac);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.irow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
}
.irow > span {
  color: var(--ld-content-2);
}
.irow strong {
  color: var(--ld-ink);
}
.irow strong.rate {
  color: var(--ld-brand-active);
}
.prog-block {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.codes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.codes-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ld-ink);
}
.export {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--ld-brand);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.export:disabled {
  opacity: 0.5;
}
.codes-note {
  margin: 0;
  font-size: 11px;
  color: var(--ld-content-2);
}
.code-list {
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  overflow: hidden;
}
.code-loading {
  margin: 0;
  padding: 14px;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.code-row {
  padding: 9px 13px;
  font-family: var(--ld-font-mono);
  font-size: 12px;
  color: var(--ld-ink);
  border-top: 1px solid var(--ld-line);
}
.code-row:first-child {
  border-top: none;
}
.code-more {
  padding: 9px 13px;
  border-top: 1px solid var(--ld-line);
  font-size: 11.5px;
  color: var(--ld-content-2);
}
</style>
