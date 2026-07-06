<script setup lang="ts">
// 系统巡检·体检面板（design 语言一致·批3·治病根#14 告警进人眼）：最新体检报告（A 基建存活 + B 业务不变量
// 红绿灯）+ 立即巡检（手动触发一轮）+ 未处理异常入口。数据走 adminApi getInspectStatus/runInspect 真值·不编数。
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { PlayCircle, TriangleAlert, ShieldCheck } from 'lucide-vue-next'
import { getInspectStatus, runInspect } from '../api/ops'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

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
  <div class="ld-page">
    <PageHeader
      title="系统巡检"
      sub="定时/手动核对基础运行 · 主动探出静默失败（付了钱没发货 / 多退钱 / 待退款死信…）· 不依赖 AI"
    >
      <UiButton :disabled="running" @click="runNow">
        <PlayCircle :size="16" :stroke-width="1.8" :class="{ spin: running }" />
        <span>{{ running ? '巡检中…' : '立即巡检' }}</span>
      </UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <div v-if="openAnomalies" class="alert" @click="router.push('/anomalies')">
      <div class="alert-ico"><TriangleAlert :size="20" :stroke-width="1.8" /></div>
      <div class="alert-body">
        <div class="alert-title">{{ openAnomalies }} 条未处理异常</div>
        <div class="alert-detail">点开去异常账本逐条处理 →</div>
      </div>
    </div>

    <template v-if="latest">
      <div class="summary">
        <Badge tone="green">{{ latest.summary.green }} 正常</Badge>
        <Badge v-if="latest.summary.yellow" tone="amber">{{ latest.summary.yellow }} 可疑</Badge>
        <Badge :tone="latest.summary.red ? 'red' : 'green'">{{ latest.summary.red }} 异常</Badge>
        <span class="run-meta">{{ latest.trigger === 'manual' ? '手动' : '定时' }} · {{ fmt(latest.startedAt) }}</span>
      </div>

      <Card v-for="g in groups" :key="g.key" :title="g.label" flush>
        <div class="checks">
          <div v-for="c in g.items" :key="c.id" class="check" :class="c.status">
            <div class="check-status">
              <Badge :tone="c.status === 'green' ? 'green' : c.status === 'red' ? 'red' : 'amber'" dot>
                {{ c.status === 'green' ? '通过' : c.status === 'red' ? '异常' : '可疑' }}
              </Badge>
            </div>
            <div class="check-body">
              <div class="check-title">{{ c.title }}</div>
              <div class="check-detail">{{ c.detail }}</div>
              <div v-if="c.status === 'red' && c.samples && c.samples.length" class="samples">
                <code v-for="s in c.samples" :key="s">{{ s }}</code>
                <span v-if="c.count && c.count > c.samples.length" class="more">等 {{ c.count }} 条</span>
              </div>
            </div>
            <span v-if="c.severity === 'high'" class="sev">高危</span>
          </div>
        </div>
      </Card>
    </template>
    <EmptyState v-else-if="!message" :icon="ShieldCheck" text="还没跑过巡检 · 点右上「立即巡检」跑一轮" />
  </div>
</template>

<style scoped>
/* 立即巡检按钮内 loading 图标转圈（本页独有） */
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 未处理异常告警条（红底可点入口·本页独有语义块·无 kit alert 原语） */
.alert {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  background: var(--ld-bg-red-soft);
  border: 1px solid var(--ld-red-line);
  border-radius: var(--ld-radius);
  cursor: pointer;
}
.alert-ico {
  display: flex;
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

/* 汇总胶囊行：green/yellow/red 徽章走 Badge·此处只排布 + 右侧运行 meta */
.summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.run-meta {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}

/* 分组巡检结果：外壳走 flush Card·内部逐条守卫行（本页独有） */
.checks {
  border-top: 1px solid var(--ld-line);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--ld-line);
}
.check:last-child {
  border-bottom: none;
}
.check.red {
  background: var(--ld-bg-red-soft);
}
.check-status {
  flex: none;
  margin-top: 1px;
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
  border-radius: var(--ld-radius-sm);
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
  margin-top: 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ld-red);
}
</style>
