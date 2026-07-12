<script setup lang="ts">
// 人工配置清单（批 B9·设计契约：TopBar chip + 说明 banner + 单卡分组表）：把散落在云函数环境变量 /
// admin 页内 DB 字段 / 纯人工外部后台项 / 资产正册的 12 项配置拼一屏「配了没」——**只探测状态，
// 从不回显任何密钥/配置值**（后端 getConfigChecklist 铁律·守卫 rewrite/cloud/tests/config-checklist.test.ts）。
import { ref, onMounted } from 'vue'
import { ShieldCheck, RefreshCw } from 'lucide-vue-next'
import { getConfigChecklist } from '../api/system'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import UiButton from '../components/ui/Button.vue'
import EmptyState from '../components/ui/EmptyState.vue'

type Status = 'ok' | 'missing' | 'check'
interface Item {
  key: string
  name: string
  location: string
  purpose: string
  status: Status
  howTo: string
  url: string
  noteExtra?: string
}
interface Group {
  group: string
  items: Item[]
}

const groups = ref<Group[]>([])
const message = ref('加载中…')
const loading = ref(false)

const toneOf = (s: Status) => (s === 'ok' ? 'green' : s === 'missing' ? 'red' : 'amber')
const labelOf = (s: Status) => (s === 'ok' ? '已配' : s === 'missing' ? '未配' : '需人工核对')

async function load() {
  loading.value = true
  const r: any = await getConfigChecklist()
  loading.value = false
  if (r.error === 'SESSION_LOST') return // 会话失效集中导登录（client.onSessionLost·单源·根因#5）
  if (!r.ok) {
    message.value = '加载失败：' + String(r.error || '')
    return
  }
  groups.value = (r.groups || []) as Group[]
  message.value = ''
}

onMounted(load)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="人工配置清单" sub="12 项散落配置一屏「配了没」 · 探不到的（企微/微信客服/小程序后台）恒需人工核对">
      <Badge tone="neutral" dot>只探测状态 · 不回显密钥</Badge>
      <UiButton variant="ghost" :disabled="loading" @click="load">
        <RefreshCw :size="14" :stroke-width="1.8" :class="{ spin: loading }" />
        <span>{{ loading ? '探测中…' : '重新探测' }}</span>
      </UiButton>
    </PageHeader>

    <div class="banner">
      每次点开或点「重新探测」都会重新查一遍云函数环境变量 / admin 数据库字段的存在与否——绿=已配、
      红=未配、琥珀=代码探不到（cs 函数环境变量各自独立配置 / 企业微信·微信客服·小程序后台纯人工项），
      需要人工去对应后台核实一遍。
    </div>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <Card v-if="groups.length" flush>
      <div class="checklist">
        <template v-for="g in groups" :key="g.group">
          <div class="group-head">{{ g.group }}</div>
          <div v-for="it in g.items" :key="it.key" class="row">
            <div class="row-name-col">
              <div class="row-name">{{ it.name }}</div>
              <div class="row-loc">{{ it.location }}</div>
            </div>
            <div class="row-purpose">{{ it.purpose }}</div>
            <div class="row-status">
              <Badge :tone="toneOf(it.status)">{{ labelOf(it.status) }}</Badge>
            </div>
            <div class="row-howto">
              <div class="howto-text">{{ it.howTo }}</div>
              <div v-if="it.url" class="howto-url">{{ it.url }}</div>
              <div v-if="it.noteExtra" class="howto-note">{{ it.noteExtra }}</div>
            </div>
          </div>
        </template>
      </div>
    </Card>
    <EmptyState v-else-if="!message" :icon="ShieldCheck" text="没有可展示的配置项" />
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

/* 说明 banner（同 Settings.vue roadmap 语言：lilac 底·虚线描边） */
.banner {
  padding: 12px 16px;
  background: var(--ld-bg-lilac);
  border: 1px dashed var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12px;
  line-height: 1.7;
  color: var(--ld-content-2);
}

/* 单卡分组表：分组头分隔 + 四列行（名称位置 / 用途 / 状态 / 获取方式） */
.checklist {
  display: flex;
  flex-direction: column;
}
.group-head {
  padding: 12px 18px 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ld-content-2);
  background: var(--ld-bg-grey);
  border-bottom: 1px solid var(--ld-line);
}
.row {
  display: grid;
  grid-template-columns: 1.4fr 1.2fr 0.9fr 1.6fr;
  gap: 14px;
  align-items: start;
  padding: 12px 18px;
  border-bottom: 1px solid var(--ld-line);
}
.row:last-child {
  border-bottom: none;
}
.row-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ld-ink);
}
.row-loc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ld-content-2);
}
.row-purpose {
  font-size: 12.5px;
  color: var(--ld-content);
  line-height: 1.55;
}
.row-status {
  margin-top: 1px;
}
.row-howto {
  min-width: 0;
}
.howto-text {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-brand-active);
  line-height: 1.5;
}
.howto-url {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ld-content-2);
  word-break: break-all;
}
.howto-note {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ld-amber);
}

@media (max-width: 900px) {
  .row {
    grid-template-columns: 1fr;
  }
}
</style>
