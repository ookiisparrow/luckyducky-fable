<script setup lang="ts">
// 客户 360（M3 批5）：搜人（openid/手机/昵称/订单号）→ 全景面板（单面板失败隔离·其余照渲染）。
// 本页读他人数据全程强制留痕（云端 FORCE_AUDIT）。
import { ref } from 'vue'
import { searchCustomer, getCustomer360 } from '../api/cs'
import { matchLabel, mapPanels, type PanelVM } from '../lib/mapCs'
import { dateTime } from '../lib/format'

const q = ref('')
const hits = ref<Array<{ openid: string; nickname: string; phone: string; matched: string; createdAt: string }>>([])
const panels = ref<PanelVM[]>([])
const current = ref('')
const message = ref('')

async function search() {
  if (!q.value.trim()) return
  message.value = '搜索中…'
  panels.value = []
  current.value = ''
  const r = await searchCustomer(q.value.trim())
  hits.value = r.ok
    ? ((r.customers as Record<string, any>[]) || []).map((c) => ({
        openid: String(c.openid || ''),
        nickname: String(c.nickname || '（无昵称）'),
        phone: String(c.phone || ''),
        matched: matchLabel(c.matchedBy),
        createdAt: dateTime(c.createdAt),
      }))
    : []
  message.value = r.ok ? (hits.value.length ? '' : '没找到匹配的客户') : '搜索失败：' + String(r.error || '')
}

async function open(openid: string) {
  current.value = openid
  message.value = '加载全景…'
  const r = await getCustomer360(openid)
  panels.value = r.ok ? mapPanels(r) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}
</script>

<template>
  <div>
    <h2>客户 360</h2>
    <p class="hint">按 openid / 手机号 / 昵称 / 订单号 搜索。每次查看都会留审计痕。</p>
    <div class="searchrow">
      <input v-model="q" placeholder="搜索客户…" @keyup.enter="search" />
      <button class="act" @click="search">搜索</button>
    </div>
    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="hits.length && !current" class="hits">
      <div v-for="h in hits" :key="h.openid" class="hit" @click="open(h.openid)">
        <strong>{{ h.nickname }}</strong>
        <span v-if="h.phone">{{ h.phone }}</span>
        <span class="matched">命中：{{ h.matched }}</span>
        <span class="time">{{ h.createdAt }}</span>
      </div>
    </div>

    <div v-if="panels.length" class="panels">
      <p class="backline"><button class="act ghost" @click="panels = []; current = ''">‹ 返回结果</button> <code>{{ current }}</code></p>
      <div v-for="p in panels" :key="p.key" class="panel">
        <h3>{{ p.label }}</h3>
        <p v-if="p.failed" class="failed">该面板取数失败（其余不受影响）</p>
        <table v-else-if="p.rows.length">
          <tbody>
            <tr v-for="row in p.rows" :key="row.k"><td class="k">{{ row.k }}</td><td>{{ row.v }}</td></tr>
          </tbody>
        </table>
        <p v-else class="empty">无数据</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 8px;
  color: var(--ld-purple-ink);
}
.hint {
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin: 0 0 12px;
}
.searchrow {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  max-width: 480px;
}
.searchrow input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.status {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.hits {
  max-width: 560px;
}
.hit {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 10px 14px;
  margin-bottom: 8px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  cursor: pointer;
  font-size: 13px;
}
.matched {
  font-size: 11px;
  color: var(--ld-purple-tab);
}
.time {
  margin-left: auto;
  font-size: 11px;
  color: var(--ld-purple-meta);
}
.backline {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}
.panels {
  max-width: 720px;
}
.panel {
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
.panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--ld-purple-ink);
}
.failed {
  font-size: 12px;
  color: #c0392b;
}
.empty {
  font-size: 12px;
  color: var(--ld-purple-meta);
}
table {
  width: 100%;
  border-collapse: collapse;
}
td {
  padding: 5px 8px;
  font-size: 13px;
  border-bottom: 1px solid var(--ld-bg-faint);
}
td.k {
  width: 220px;
  color: var(--ld-purple-meta);
}
.act {
  padding: 7px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
  padding: 4px 12px;
  font-size: 12px;
}
</style>
