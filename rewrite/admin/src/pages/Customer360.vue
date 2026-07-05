<script setup lang="ts">
// 客户 360（设计语言一致性·M3 UI 批14）：搜人（openid/手机/昵称/订单号）→ 全景面板（单面板失败隔离·其余照渲染）。
// 本页读他人数据全程强制留痕（云端 FORCE_AUDIT）。逻辑未动，仅套设计语言。
import { ref } from 'vue'
import { Search, ChevronLeft, RotateCcw } from 'lucide-vue-next'
import { searchCustomer, getCustomer360, getUser } from '../api/cs'
import { matchLabel, mapPanels, type PanelVM } from '../lib/mapCs'
import { maskPhone } from '../lib/mapMoney'
import { dateTime } from '../lib/format'

const q = ref('')
const hits = ref<Array<{ openid: string; nickname: string; phone: string; matched: string; createdAt: string }>>([])
const panels = ref<PanelVM[]>([])
const current = ref('')
const message = ref('')
// 身份头（换皮丢·getUser 没导出·坐席查客户只剩 openid 看不到姓名/手机/画像）
const user = ref<{ nickname: string; phone: string; avatar: string; bio: string } | null>(null)

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
  user.value = null
  const [r, u] = await Promise.all([getCustomer360(openid), getUser(openid)])
  panels.value = r.ok ? mapPanels(r) : []
  if (u.ok) {
    const d = ((u as any).user || u) as Record<string, any>
    user.value = { nickname: String(d.nickname || '（无昵称）'), phone: String(d.phone || ''), avatar: String(d.avatar || ''), bio: String(d.bio || '') }
  }
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>客户 360</h1>
      <p class="sub">按 openid / 手机号 / 昵称 / 订单号 搜索。每次查看都会留审计痕。</p>
    </header>

    <div class="searchbox">
      <Search :size="15" :stroke-width="1.8" class="search-ico" />
      <input v-model="q" placeholder="搜索客户（openid / 手机 / 昵称 / 订单号）…" @keyup.enter="search" />
      <button class="btn-primary" @click="search">搜索</button>
    </div>
    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="hits.length && !current" class="hits">
      <div v-for="h in hits" :key="h.openid" class="hit" @click="open(h.openid)">
        <div class="hit-main">
          <div class="hit-name">{{ h.nickname }}</div>
          <div class="hit-sub">{{ maskPhone(h.phone) || '—' }} · <span class="mono">{{ h.openid.slice(-12) }}</span></div>
        </div>
        <span class="matched">命中 {{ h.matched }}</span>
        <span class="time">{{ h.createdAt }}</span>
      </div>
    </div>

    <div v-if="panels.length" class="panels">
      <div class="backline">
        <button class="back" @click="panels = []; current = ''; user = null"><ChevronLeft :size="14" :stroke-width="2" /><span>返回结果</span></button>
        <button class="back" title="刷新全景" @click="open(current)"><RotateCcw :size="13" :stroke-width="2" /><span>刷新</span></button>
        <code>{{ current }}</code>
      </div>

      <!-- 身份头（换皮丢·getUser 未导出）：头像/昵称/手机(掩码)/openid/bio -->
      <div v-if="user" class="idcard">
        <img v-if="user.avatar" :src="user.avatar" class="avatar" alt="" />
        <div v-else class="avatar ph">👤</div>
        <div class="id-info">
          <div class="id-name">{{ user.nickname }}</div>
          <div class="id-meta">{{ maskPhone(user.phone) || '（无手机）' }} · <span class="mono">{{ current.slice(-16) }}</span></div>
          <div v-if="user.bio" class="id-bio">{{ user.bio }}</div>
        </div>
      </div>

      <div class="panel-grid">
        <div v-for="p in panels" :key="p.key" class="panel">
          <h2>{{ p.label }}</h2>
          <p v-if="p.failed" class="failed">该面板取数失败（其余不受影响）</p>
          <div v-else-if="p.rows.length" class="kv">
            <div v-for="row in p.rows" :key="row.k" class="kvrow"><span class="k">{{ row.k }}</span><span class="v">{{ row.v }}</span></div>
          </div>
          <p v-else class="empty">无数据</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 980px;
}
.page-head {
  margin-bottom: 16px;
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
.searchbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 14px;
  margin-bottom: 12px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  max-width: 560px;
}
.search-ico {
  color: var(--ld-content-2);
  flex: none;
}
.searchbox input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--ld-ink);
}
.btn-primary {
  flex: none;
  padding: 8px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.status {
  font-size: 13px;
  color: var(--ld-content-2);
}
.hits {
  max-width: 640px;
}
.hit {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  cursor: pointer;
}
.hit:hover {
  border-color: var(--ld-purple-line);
}
.hit-main {
  flex: 1;
  min-width: 0;
}
.hit-name {
  font-weight: 600;
  color: var(--ld-ink);
}
.hit-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.mono {
  font-family: var(--ld-font-mono);
}
.matched {
  flex: none;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-size: 11px;
  font-weight: 600;
}
.time {
  flex: none;
  font-size: 11px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.backline {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 6px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 12.5px;
  cursor: pointer;
}
.backline code {
  font-size: 11.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.idcard {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  margin-bottom: 14px;
  background: var(--ld-bg-lilac);
  border-radius: var(--ld-radius-l);
}
.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
  background: var(--ld-bg-sage);
}
.avatar.ph {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.id-info {
  min-width: 0;
}
.id-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--ld-ink);
}
.id-meta {
  margin-top: 3px;
  font-size: 12px;
  color: var(--ld-content-2);
}
.id-bio {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ld-content);
}
.panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 800px) {
  .panel-grid {
    grid-template-columns: 1fr;
  }
}
.panel {
  padding: 16px 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.panel h2 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
.failed {
  font-size: 12px;
  color: var(--ld-red);
}
.empty {
  font-size: 12px;
  color: var(--ld-content-2);
}
.kv {
  display: flex;
  flex-direction: column;
}
.kvrow {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid var(--ld-line);
  font-size: 12.5px;
}
.kvrow:first-child {
  border-top: none;
}
.k {
  width: 40%;
  flex: none;
  color: var(--ld-content-2);
}
.v {
  flex: 1;
  color: var(--ld-content);
  word-break: break-word;
}
</style>
