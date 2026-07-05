<script setup lang="ts">
// 异常监测·bug 账本（design 语言一致·批3·治病根#14）：四路来源（服务端异常/不变量违反/关键流程失败/
// 客户端错误）统一账本·指纹去重（count 累加）·可筛未处理/已处理·标记已处理。数据走 adminApi listAnomalies/
// resolveAnomaly 真值。
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, Check } from 'lucide-vue-next'
import { listAnomalies, resolveAnomaly } from '../api/ops'

const router = useRouter()
const list = ref<any[]>([])
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

async function load() {
  busy.value = true
  const opts: { resolved?: boolean } = {}
  if (filter.value === 'open') opts.resolved = false
  else if (filter.value === 'resolved') opts.resolved = true
  const r: any = await listAnomalies(opts)
  busy.value = false
  if (r.error === 'SESSION_LOST') return void router.push('/login')
  list.value = r.list || []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

async function markResolved(a: any) {
  const r: any = await resolveAnomaly(a._id)
  if (r.error === 'SESSION_LOST') return void router.push('/login')
  if (r.ok) await load()
}

function setFilter(f: 'open' | 'resolved' | 'all') {
  filter.value = f
  void load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>异常监测</h1>
        <p class="sub">运行中不符合预期的行为统一账本 · 同类去重（次数累加）· 高危已实时推企微</p>
      </div>
      <button class="btn-refresh" :disabled="busy" @click="load">
        <RefreshCw :size="15" :stroke-width="1.8" :class="{ spin: busy }" />
        <span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </button>
    </header>

    <div class="chips">
      <button v-for="f in FILTERS" :key="f.key" class="chip" :class="{ on: filter === f.key }" @click="setFilter(f.key)">
        {{ f.label }}
      </button>
    </div>

    <p v-if="message" class="status">{{ message }}</p>
    <p v-else-if="!list.length" class="empty">{{ filter === 'open' ? '没有未处理异常 ✓' : '暂无记录' }}</p>

    <div v-for="a in list" :key="a._id" class="row" :class="{ done: a.resolved }">
      <span class="sev-bar" :class="a.severity" />
      <div class="row-body">
        <div class="row-top">
          <span class="kind" :class="a.kind">{{ KIND_LABEL[a.kind] || a.kind }}</span>
          <code class="code">{{ a.code }}</code>
          <span v-if="a.severity === 'high'" class="badge-high">高危</span>
          <span v-if="a.count > 1" class="count">×{{ a.count }}</span>
        </div>
        <div v-if="ctxPairs(a.ctx)" class="ctx">{{ ctxPairs(a.ctx) }}</div>
        <div class="meta">最近 {{ fmt(a.lastSeen) }}<span v-if="a.resolved"> · 已处理 {{ a.resolvedBy || '' }}</span></div>
      </div>
      <button v-if="!a.resolved" class="btn-resolve" @click="markResolved(a)">
        <Check :size="14" :stroke-width="2" />
        <span>标记已处理</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1000px;
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
  flex: none;
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
.chips {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.chip {
  padding: 6px 16px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 12.5px;
  cursor: pointer;
}
.chip.on {
  background: var(--ld-ink);
  border-color: var(--ld-ink);
  color: #fff;
}
.status,
.empty {
  font-size: 13px;
  color: var(--ld-content-2);
  padding: 24px 0;
}
.empty {
  text-align: center;
  color: var(--ld-green);
}
.row {
  display: flex;
  align-items: stretch;
  gap: 12px;
  padding: 14px 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  margin-bottom: 8px;
}
.row.done {
  opacity: 0.62;
}
.sev-bar {
  width: 4px;
  border-radius: 999px;
  flex: none;
  background: var(--ld-content-2);
}
.sev-bar.high {
  background: var(--ld-red);
}
.row-body {
  flex: 1;
  min-width: 0;
}
.row-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.kind {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand);
}
.code {
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ld-ink);
}
.badge-high {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  font-size: 11px;
  font-weight: 700;
}
.count {
  font-size: 12px;
  font-weight: 700;
  color: var(--ld-amber);
}
.ctx {
  margin-top: 5px;
  font-size: 12px;
  color: var(--ld-content);
  font-family: var(--ld-font-mono);
  word-break: break-all;
}
.meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--ld-content-2);
}
.btn-resolve {
  flex: none;
  align-self: center;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content);
  font-size: 12.5px;
  cursor: pointer;
}
.btn-resolve:hover {
  border-color: var(--ld-green);
  color: var(--ld-green);
}
</style>
