<script setup lang="ts">
// 客户 360（设计语言一致性·M3 UI 批14）：搜人（openid/手机/昵称/订单号）→ 全景面板（单面板失败隔离·其余照渲染）。
// 本页读他人数据全程强制留痕（云端 FORCE_AUDIT）。逻辑未动，仅套设计语言。
import { ref } from 'vue'
import { Search, ChevronLeft, RotateCcw, User } from 'lucide-vue-next'
import { searchCustomer, getCustomer360, getUser } from '../api/cs'
import { matchLabel, mapPanels, type PanelVM } from '../lib/mapCs'
import { maskPhone } from '../lib/mapMoney'
import { useLatest } from '../lib/latest'
import { dateTime } from '../lib/format'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const q = ref('')
const hits = ref<Array<{ openid: string; nickname: string; phone: string; matched: string; createdAt: string }>>([])
const panels = ref<PanelVM[]>([])
const current = ref('')
const message = ref('')
// 身份头（换皮丢·getUser 没导出·坐席查客户只剩 openid 看不到姓名/手机/画像）
const user = ref<{ nickname: string; phone: string; avatar: string; bio: string } | null>(null)

const searchGen = useLatest() // 搜索乱序守卫（P2·照同页 open() 的 panoGen 范式·item4：快速改词连搜·旧回包别覆盖新搜索结果）
async function search() {
  if (!q.value.trim()) return
  message.value = '搜索中…'
  panels.value = []
  current.value = ''
  user.value = null // 新一轮搜索即清上一客户身份头残留（P1·回归修复：身份头移出 panels 连坐 v-if 后单独有此残留窗口——
  // 未点「返回结果」直接改词重搜，若不清会与新命中列表并排显示旧客户 PII，同 open() 起始处清法一致）
  const my = searchGen.begin()
  const r = await searchCustomer(q.value.trim())
  if (searchGen.isStale(my)) return // 已发起更新的搜索·丢弃过期结果
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

const panoGen = useLatest() // 全景乱序守卫（P1·FORCE_AUDIT 页·A 的私域全景别落到标 B 的头下·根因#8）
async function open(openid: string) {
  current.value = openid
  message.value = '加载全景…'
  user.value = null
  panels.value = [] // 起始清旧全景（防刷新在途时旧 A 面板残留·再切人错配）
  const my = panoGen.begin()
  const [r, u] = await Promise.all([getCustomer360(openid), getUser(openid)])
  if (panoGen.isStale(my) || current.value !== openid) return // 已切别人/别页·丢弃过期全景（防跨人隐私错配）
  panels.value = r.ok ? mapPanels(r) : []
  if (u.ok) {
    const d = ((u as any).user || u) as Record<string, any>
    user.value = { nickname: String(d.nickname || '（无昵称）'), phone: String(d.phone || ''), avatar: String(d.avatar || ''), bio: String(d.bio || '') }
  }
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}
</script>

<template>
  <div class="ld-page">
    <PageHeader title="客户 360" sub="按 openid / 手机号 / 昵称 / 订单号 搜索。每次查看都会留审计痕。" />

    <!-- 搜索工具条（真值：搜人入口） -->
    <div class="ld-toolbar">
      <label class="ld-search grow-search">
        <Search :size="15" :stroke-width="1.8" class="search-ico" />
        <input v-model="q" placeholder="搜索客户（openid / 手机 / 昵称 / 订单号）…" @keyup.enter="search" />
      </label>
      <UiButton @click="search"><Search :size="15" :stroke-width="1.8" /><span>搜索</span></UiButton>
    </div>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <!-- 命中列表（真值：搜索结果·点开进全景） -->
    <Card v-if="hits.length && !current" flush>
      <div class="ld-table">
        <div class="ld-thead">
          <div class="ld-th grow">客户</div>
          <div class="ld-th" :style="{ width: '140px' }">手机</div>
          <div class="ld-th" :style="{ width: '130px' }">命中</div>
          <div class="ld-th" :style="{ width: '160px' }">注册时间</div>
        </div>
        <div class="ld-tbody">
          <div v-for="h in hits" :key="h.openid" class="ld-tr hit-row" @click="open(h.openid)">
            <div class="ld-td grow">
              <div class="hit-id">
                <span class="hit-name">{{ h.nickname }}</span>
                <span class="hit-openid mono">{{ h.openid }}</span>
              </div>
            </div>
            <div class="ld-td" :style="{ width: '140px' }">{{ maskPhone(h.phone) || '—' }}</div>
            <div class="ld-td" :style="{ width: '130px' }">
              <Badge v-if="h.matched" tone="brand">{{ h.matched }}</Badge>
              <span v-else class="dim">—</span>
            </div>
            <div class="ld-td mono time" :style="{ width: '160px' }">{{ h.createdAt }}</div>
          </div>
        </div>
      </div>
    </Card>

    <!-- 返回/刷新 + 当前 openid（current 一旦选中即显·含加载失败/加载中——给「回结果」与「重试」入口·防死胡同 P2·根因#8：
         旧版返回/刷新裹在 v-if="panels.length" 里，取数失败 panels 为空即连同返回按钮整段不渲染、命中表又因 current 有值被藏，页面成死胡同） -->
    <div v-if="current" class="ld-toolbar back-row">
      <UiButton size="sm" variant="ghost" @click="panels = []; current = ''; user = null; message = ''">
        <ChevronLeft :size="15" :stroke-width="2" /><span>返回结果</span>
      </UiButton>
      <UiButton size="sm" variant="ghost" title="刷新全景" @click="open(current)">
        <RotateCcw :size="14" :stroke-width="2" /><span>刷新</span>
      </UiButton>
      <code class="cur mono">{{ current }}</code>
    </div>

    <!-- 身份头（真值·换皮丢·getUser 未导出）：头像/昵称/手机(掩码)/openid/bio——P2·item3：与下方 360
         面板区解耦，getUser 独立成功即显，不因 panels 取数失败（mapPanels 空）被 v-if="panels.length" 连坐隐藏 -->
    <Card v-if="user">
      <div class="profile">
        <img v-if="user.avatar" :src="user.avatar" class="avatar" alt="" />
        <div v-else class="avatar ph"><User :size="26" :stroke-width="1.6" /></div>
        <div class="p-info">
          <div class="p-name">{{ user.nickname }}</div>
          <div class="p-meta">{{ maskPhone(user.phone) || '（无手机）' }} · <span class="mono">{{ current }}</span></div>
          <div v-if="user.bio" class="p-bio">{{ user.bio }}</div>
        </div>
      </div>
    </Card>

    <!-- 360 面板（真值：mapPanels 面板）·取数成功才有；失败态已由上方 message 提示，身份头仍照显 -->
    <template v-if="panels.length">
      <!-- mapPanels 面板（真值·单面板失败隔离·嵌套数组逐行明细·取证价值） -->
      <div class="ld-cols-2">
        <Card v-for="p in panels" :key="p.key" :title="p.label">
          <p v-if="p.failed" class="failed">该面板取数失败（其余不受影响）</p>
          <template v-else>
            <!-- 标量字段：键值网格 -->
            <div v-if="p.rows.length" class="kv">
              <div v-for="row in p.rows" :key="row.k" class="kvrow"><span class="k">{{ row.k }}</span><span class="v">{{ row.v }}</span></div>
            </div>
            <!-- 嵌套数组明细：逐行逐字段成键值卡片（换皮误塌成「N 条」·真复原 360 取证价值） -->
            <div v-for="g in p.groups" :key="g.name" class="grp">
              <p class="grp-cap">{{ g.name }}（{{ g.count }}）</p>
              <p v-if="!g.items.length" class="empty">暂无</p>
              <ul v-else class="rows">
                <li v-for="(item, i) in g.items" :key="i" class="rowcard">
                  <span v-for="(f, j) in item" :key="j" class="cell"><em>{{ f.k }}</em>{{ f.v }}</span>
                </li>
              </ul>
              <p v-if="g.capped" class="empty">共 {{ g.count }} 条·仅显前 {{ g.items.length }}（余略）</p>
            </div>
            <p v-if="!p.rows.length && !p.groups.length" class="empty">无数据</p>
          </template>
        </Card>
      </div>
    </template>

    <!-- 初始引导（无真数据·仅提示·不编造画像） -->
    <EmptyState v-if="!hits.length && !panels.length && !message" :icon="Search" text="搜索客户以查看 360 全景（openid / 手机 / 昵称 / 订单号）" />
  </div>
</template>

<style scoped>
/* 搜索框在工具条里撑开 */
.grow-search {
  flex: 1;
  max-width: 520px;
}
.grow-search input {
  flex: 1;
  width: 100%;
}
.search-ico {
  color: var(--ld-content-2);
  flex: none;
}
.mono {
  font-family: var(--ld-font-mono);
}
.dim {
  color: var(--ld-content-2);
}

/* 命中行：整行可点开全景 */
.hit-row {
  cursor: pointer;
}
.hit-row:hover {
  background: var(--ld-bg-lilac);
}
.hit-id {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.hit-name {
  font-weight: 600;
  color: var(--ld-ink);
}
.hit-openid {
  font-size: 11.5px;
  color: var(--ld-content-2);
  word-break: break-all;
}
.time {
  font-size: 12px;
  color: var(--ld-content-2);
}

/* 返回条：当前 openid 全显 */
.back-row {
  align-items: center;
}
.cur {
  font-size: 11.5px;
  color: var(--ld-content-2);
  word-break: break-all;
}

/* 身份头 */
.profile {
  display: flex;
  align-items: center;
  gap: 16px;
}
.avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
  background: var(--ld-bg-sage);
}
.avatar.ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ld-content-2);
}
.p-info {
  min-width: 0;
}
.p-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--ld-ink);
}
.p-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ld-content-2);
  word-break: break-all;
}
.p-bio {
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--ld-content);
}

/* 面板取数失败/空态 */
.failed {
  margin: 0;
  font-size: 12.5px;
  color: var(--ld-red);
}
.empty {
  margin: 0;
  font-size: 12px;
  color: var(--ld-content-2);
}

/* 标量键值网格 */
.kv {
  display: flex;
  flex-direction: column;
}
.kvrow {
  display: flex;
  gap: 12px;
  padding: 7px 0;
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

/* 嵌套数组明细分组：逐行逐字段成卡片（真复原·取证价值） */
.grp {
  margin-top: 14px;
}
.grp:first-child {
  margin-top: 0;
}
.grp-cap {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-brand-active);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rowcard {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 12.5px;
  color: var(--ld-content);
}
.cell {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}
.cell em {
  font-style: normal;
  font-size: 11px;
  color: var(--ld-content-2);
}
</style>
