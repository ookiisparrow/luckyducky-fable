<script setup lang="ts">
// 系统巡检·体检面板（design 语言一致·批3·治病根#14 告警进人眼）：最新体检报告（A 基建存活 + B 业务不变量
// 红绿灯）+ 立即巡检（手动触发一轮）+ 未处理异常入口。数据走 adminApi getInspectStatus/runInspect 真值·不编数。
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { PlayCircle, TriangleAlert } from 'lucide-vue-next'
import { getInspectStatus, runInspect } from '../api/ops'

const router = useRouter()
const latest = ref<any>(null)
const openAnomalies = ref(0)
const message = ref('加载中…')
const running = ref(false)

const groups = computed(() => {
  const rs = (latest.value?.results || []) as any[]
  return [
    { key: 'infra', label: '基建存活', items: rs.filter((r) => r.layer === 'infra') },
    { key: 'invariant', label: '业务不变量', items: rs.filter((r) => r.layer === 'invariant') },
  ].filter((g) => g.items.length)
})

function fmt(ms: number) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(ms)
  }
}

async function load() {
  const r: any = await getInspectStatus()
  if (r.error === 'SESSION_LOST') return void router.push('/login')
  latest.value = r.latest
  openAnomalies.value = Number(r.openAnomalies || 0)
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

async function runNow() {
  running.value = true
  const r: any = await runInspect()
  running.value = false
  if (r.error === 'SESSION_LOST') return void router.push('/login')
  if (r.ok) latest.value = r.run
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>系统巡检</h1>
        <p class="sub">定时/手动核对基础运行 · 主动探出静默失败（付了钱没发货 / 多退钱 / 待退款死信…）· 不依赖 AI</p>
      </div>
      <button class="btn-run" :disabled="running" @click="runNow">
        <PlayCircle :size="16" :stroke-width="1.8" :class="{ spin: running }" />
        <span>{{ running ? '巡检中…' : '立即巡检' }}</span>
      </button>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="openAnomalies" class="alert" @click="router.push('/anomalies')">
      <div class="alert-ico"><TriangleAlert :size="20" :stroke-width="1.8" /></div>
      <div class="alert-body">
        <div class="alert-title">{{ openAnomalies }} 条未处理异常</div>
        <div class="alert-detail">点开去异常账本逐条处理 →</div>
      </div>
    </div>

    <template v-if="latest">
      <div class="summary">
        <span class="pill green">{{ latest.summary.green }} 正常</span>
        <span v-if="latest.summary.yellow" class="pill amber">{{ latest.summary.yellow }} 可疑</span>
        <span class="pill" :class="latest.summary.red ? 'red' : 'green'">{{ latest.summary.red }} 异常</span>
        <span class="run-meta">{{ latest.trigger === 'manual' ? '手动' : '定时' }} · {{ fmt(latest.startedAt) }}</span>
      </div>

      <section v-for="g in groups" :key="g.key" class="group">
        <h2 class="group-head">{{ g.label }}</h2>
        <div v-for="c in g.items" :key="c.id" class="check" :class="c.status">
          <span class="dot" :class="c.status" />
          <div class="check-body">
            <div class="check-title">{{ c.title }}</div>
            <div class="check-detail">{{ c.detail }}</div>
            <div v-if="c.status === 'red' && c.samples && c.samples.length" class="samples">
              <code v-for="s in c.samples" :key="s">{{ s }}</code>
              <span v-if="c.count && c.count > c.samples.length" class="more">等 {{ c.count }} 条</span>
            </div>
          </div>
          <span class="sev" :class="c.severity">{{ c.severity === 'high' ? '高危' : '' }}</span>
        </div>
      </section>
    </template>
    <p v-else-if="!message" class="empty">还没跑过巡检 · 点右上「立即巡检」跑一轮</p>
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
.btn-run {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-brand);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  flex: none;
}
.btn-run:disabled {
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
  padding: 14px 18px;
  margin-bottom: 18px;
  background: var(--ld-bg-red-soft);
  border: 1px solid var(--ld-red-line);
  border-radius: var(--ld-radius-l);
  cursor: pointer;
}
.alert-ico {
  color: var(--ld-red);
  flex: none;
}
.alert-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-red);
}
.alert-detail {
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--ld-content);
}
.summary {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}
.pill {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
}
.pill.green {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.pill.red {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.pill.amber {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.run-meta {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.group {
  margin-bottom: 20px;
}
.group-head {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ld-content-2);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  margin-bottom: 8px;
}
.check.red {
  background: var(--ld-bg-red-soft);
  border-color: var(--ld-red-line);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex: none;
  margin-top: 4px;
}
.dot.green {
  background: var(--ld-green);
}
.dot.red {
  background: var(--ld-red);
}
.dot.yellow {
  background: var(--ld-amber);
}
.check-body {
  flex: 1;
  min-width: 0;
}
.check-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ld-ink);
}
.check-detail {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--ld-content);
}
.samples {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.samples code {
  padding: 2px 8px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-red-line);
  border-radius: 6px;
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
  color: var(--ld-red);
}
.more {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.sev {
  flex: none;
  font-size: 11px;
  font-weight: 700;
}
.sev.high {
  color: var(--ld-red);
}
.empty {
  font-size: 13px;
  color: var(--ld-content-2);
  padding: 40px 0;
  text-align: center;
}
</style>
