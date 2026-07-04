<script setup lang="ts">
// 数据看板（M3 批2 真渲染）：经营卡片 + 转化速览 + 钱链异常警报（有则必显·点单号可去处理）。
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getDashboard } from '../api/money'
import { mapDashboard } from '../lib/mapMoney'

const router = useRouter()
const vm = ref<ReturnType<typeof mapDashboard>>(null)
const message = ref('加载中…')

onMounted(async () => {
  const r = await getDashboard()
  if (r.error === 'SESSION_LOST') {
    void router.push('/login')
    return
  }
  vm.value = mapDashboard(r)
  message.value = vm.value ? '' : '看板加载失败：' + String(r.error || '')
})
</script>

<template>
  <div>
    <h2>数据看板</h2>
    <p v-if="message" class="status">{{ message }}</p>
    <template v-if="vm">
      <div class="cards">
        <div v-for="c in vm.cards" :key="c.label" class="card">
          <div class="card-label">{{ c.label }}</div>
          <div class="card-value">{{ c.value }}</div>
          <div v-if="c.note" class="card-note">{{ c.note }}</div>
        </div>
      </div>
      <h3>转化速览</h3>
      <div class="cards">
        <div v-for="c in vm.funnel" :key="c.label" class="card slim">
          <div class="card-label">{{ c.label }}</div>
          <div class="card-value">{{ c.value }}</div>
        </div>
      </div>
      <template v-if="vm.alerts.length">
        <h3 class="alert-h">⚠ 钱链异常（须人工处理）</h3>
        <div v-for="a in vm.alerts" :key="a.label" class="alert">
          <strong>{{ a.label }}</strong>：<code v-for="id in a.ids" :key="id">{{ id }}</code>
        </div>
      </template>
      <p v-else class="ok-line">钱链无异常单 ✓</p>
    </template>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 16px;
  color: var(--ld-purple-ink);
}
h3 {
  margin: 24px 0 12px;
  font-size: 15px;
  color: var(--ld-purple-ink);
}
.status {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.card {
  min-width: 160px;
  padding: 16px 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
.card.slim {
  min-width: 110px;
}
.card-label {
  font-size: 12px;
  color: var(--ld-purple-meta);
}
.card-value {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--ld-purple-ink);
}
.card-note {
  margin-top: 4px;
  font-size: 11px;
  color: var(--ld-purple-meta);
}
.alert-h {
  color: #c0392b;
}
.alert {
  padding: 10px 14px;
  margin-bottom: 8px;
  background: #fff6f5;
  border: 1px solid #f0c0ba;
  border-radius: var(--ld-radius);
  font-size: 13px;
}
.alert code {
  margin-left: 8px;
  background: var(--ld-bg-faint);
  padding: 2px 6px;
  border-radius: 4px;
}
.ok-line {
  margin-top: 20px;
  font-size: 13px;
  color: var(--ld-purple-tab);
}
</style>
