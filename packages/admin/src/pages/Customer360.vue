<script setup>
/**
 * 客户360 查询页（后台360工作站 B1.4·M①）。坐席按 openid/手机/订单号/昵称搜客户 → 选中 → 看全貌。
 *
 * 铁律三「admin 同构」：本页**通用渲染**后端 getCustomer360 返回的 panels 数组——遍历 panels、按数据形状
 * （标量→键值网格 / 数组→逐行卡片）渲染，**不硬编码面板类型**（后端加/删板块 admin 零改·开放-封闭）。
 * 字段中文名走 LABELS 映射、未知字段回退原始 key（新板块仍可渲染·只是用原始字段名）。守卫 cs-panel-via-provider 焊之。
 *
 * 越权读（§1.5）：searchCustomer/getCustomer360/getUser 后端经 customer:view 闸 + 强制审计留痕（谁查了谁），
 * 本页只发起读、不碰审计/能力（闸在云端 adminApi 分发处收口）。
 */
import { ref } from 'vue'
import { cloudMode, searchCustomer, getCustomer360, getUser } from '@/api/cloud.js'
import { Search, RefreshCw } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'

const q = ref('')
const results = ref([]) // 搜索结果 [{openid,nickname,phone,avatar,createdAt,matchedBy}]
const searched = ref(false)
const searching = ref(false)
const searchErr = ref('')

const sel = ref(null) // 选中客户的 360：{ openid, user, panels }
const loading360 = ref(false)
const err360 = ref('')

// 字段中文名（通用渲染友好名·未知字段回退原始 key·不破坏「后端给什么渲什么」铁律三）
const LABELS = {
  orderCount: '订单数', ordersCapped: '订单超采样', paidCount: '已付单', totalSpent: '总消费(元)',
  activatedCount: '激活课程', enteredCount: '已进课', enterRate: '进课率(%)', lastActiveAt: '最近活跃',
  count: '数量', capped: '超采样', status: '状态', amount: '金额(元)', createdAt: '时间',
  itemCount: '件数', trackingNo: '运单号', id: '单号', courseId: '课程', code: '激活码',
  activated: '已激活', entered: '已进课', enteredAt: '进课时间',
}
const fieldLabel = (k) => LABELS[k] || k

const fmtTime = (ms) => {
  if (!ms && ms !== 0) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const maskPhone = (p) => (p && p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : p || '—')

// 通用渲染：把面板 data 拆成 标量项 / 数组项（数组逐行渲成键值卡片·完全跟随后端形状）
const isObj = (v) => v && typeof v === 'object'
const scalarEntries = (data) =>
  isObj(data) ? Object.entries(data).filter(([, v]) => !Array.isArray(v) && !isObj(v)) : []
const arrayEntries = (data) =>
  isObj(data) ? Object.entries(data).filter(([, v]) => Array.isArray(v)) : []
function fmtVal(k, v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (/At$/.test(k) && typeof v === 'number') return fmtTime(v)
  return String(v)
}

async function doSearch() {
  const t = q.value.trim()
  if (!t || searching.value) return
  searching.value = true
  searchErr.value = ''
  searched.value = true
  try {
    results.value = await searchCustomer(t)
  } catch (e) {
    searchErr.value = '检索失败：' + e.message
    results.value = []
  } finally {
    searching.value = false
  }
}

async function selectCustomer(c) {
  sel.value = { openid: c.openid, user: null, panels: [] }
  loading360.value = true
  err360.value = ''
  try {
    const [view, user] = await Promise.all([getCustomer360(c.openid), getUser(c.openid).catch(() => null)])
    sel.value = {
      openid: view.openid,
      user: user || { openid: c.openid, nickname: c.nickname, phone: c.phone, avatar: c.avatar, bio: '' },
      panels: view.panels,
    }
  } catch (e) {
    err360.value = '加载客户360失败：' + e.message
  } finally {
    loading360.value = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>客户360</h1>
        <p class="sub">按 openid / 手机号 / 订单号 / 昵称 检索客户，查看其订单·激活·画像全貌（只读·查询留痕）</p>
      </div>
      <button v-if="sel" class="btn ghost" @click="selectCustomer({ openid: sel.openid })"><RefreshCw :size="14" />刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">客户360 需云端模式（配置 VITE_ADMIN_API）。</p>

    <template v-else>
      <div class="bar">
        <div class="search">
          <input v-model="q" class="input" placeholder="openid / 手机号 / 订单号 / 昵称" @keyup.enter="doSearch" />
          <button class="btn primary mini" :disabled="searching" @click="doSearch"><Search :size="14" />检索</button>
        </div>
      </div>

      <p v-if="searchErr" class="hint warn">{{ searchErr }}</p>

      <!-- 搜索结果 -->
      <template v-if="searched && !searchErr">
        <p v-if="searching" class="muted">检索中…</p>
        <p v-else-if="!results.length" class="hint">没有匹配「{{ q }}」的客户（openid/手机/单号需精确·昵称暂为精确匹配）</p>
        <div v-else class="card table">
          <div class="row hrow"><span>昵称</span><span>openid</span><span>手机</span><span>注册</span><span>命中</span><span class="r">操作</span></div>
          <div v-for="c in results" :key="c.openid" class="row" :class="{ on: sel && sel.openid === c.openid }">
            <span class="b">{{ c.nickname || '（未设昵称）' }}</span>
            <span class="mono">{{ c.openid }}</span>
            <span class="muted">{{ maskPhone(c.phone) }}</span>
            <span class="muted">{{ c.createdAt ? fmtTime(c.createdAt) : '—' }}</span>
            <span class="muted">{{ (c.matchedBy || []).join('/') }}</span>
            <span class="r"><button class="btn ghost mini" @click="selectCustomer(c)">查看360</button></span>
          </div>
        </div>
      </template>

      <!-- 选中客户的 360 全貌（通用渲染 panels·铁律三 同构·后端给什么面板渲什么） -->
      <section v-if="sel" class="detail">
        <div class="id-head">
          <div class="ava">{{ (sel.user && sel.user.nickname ? sel.user.nickname : 'C')[0] }}</div>
          <div class="id-main">
            <div class="id-name">{{ (sel.user && sel.user.nickname) || '（未设昵称）' }}</div>
            <div class="id-sub mono">{{ sel.openid }}</div>
          </div>
          <div v-if="sel.user" class="id-meta">
            <span v-if="sel.user.phone">手机 {{ maskPhone(sel.user.phone) }}</span>
            <span v-if="sel.user.bio">· {{ sel.user.bio }}</span>
          </div>
        </div>

        <p v-if="err360" class="hint warn">{{ err360 }}</p>
        <Skeleton v-else-if="loading360" class="card" :rows="5" />

        <div v-else class="panels">
          <article v-for="panel in sel.panels" :key="panel.key" class="panel card">
            <h3 class="panel-title">{{ panel.label }}</h3>
            <p v-if="panel.error" class="panel-err">这个板块暂时取不到（{{ panel.error }}）</p>
            <template v-else>
              <!-- 标量项：键值网格 -->
              <div v-if="scalarEntries(panel.data).length" class="kv">
                <div v-for="[k, v] in scalarEntries(panel.data)" :key="k" class="kv-item">
                  <span class="kv-k">{{ fieldLabel(k) }}</span>
                  <span class="kv-v">{{ fmtVal(k, v) }}</span>
                </div>
              </div>
              <!-- 数组项：逐行渲成键值卡片（列跟随每行形状·不固定列·通用） -->
              <div v-for="[name, list] in arrayEntries(panel.data)" :key="name" class="sub">
                <p class="sub-cap">{{ fieldLabel(name) }}（{{ list.length }}）</p>
                <p v-if="!list.length" class="muted small">暂无</p>
                <ul v-else class="rows">
                  <li v-for="(row, i) in list" :key="i" class="rowcard">
                    <span v-for="[k, v] in scalarEntries(row)" :key="k" class="cell"><em>{{ fieldLabel(k) }}</em>{{ fmtVal(k, v) }}</span>
                  </li>
                </ul>
              </div>
            </template>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
h1 {
  font-size: 22px;
  color: var(--ink);
  margin: 0 0 5px;
}
.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--content-2);
}
.bar {
  display: flex;
  align-items: center;
  margin-bottom: 14px;
}
.search {
  display: flex;
  gap: 8px;
  align-items: center;
}
.search .input {
  width: 320px;
  max-width: 60vw;
}
.muted {
  color: var(--content-2);
  font-size: 12px;
}
.small {
  font-size: 11.5px;
}
.mono {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11.5px;
}
.table {
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 1.2fr 2fr 120px 130px 90px 96px;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  font-size: 12.5px;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.hrow {
  background: var(--bg-lilac);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--content-2);
}
.row.on {
  background: var(--bg-lilac);
}
.b {
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r {
  text-align: right;
  justify-self: end;
}

/* 360 详情 */
.detail {
  margin-top: 22px;
}
.id-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  border-radius: 12px;
  margin-bottom: 14px;
}
.ava {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
}
.id-main {
  min-width: 0;
}
.id-name {
  font-weight: 700;
  font-size: 15px;
  color: var(--ink);
}
.id-sub {
  color: var(--content-2);
}
.id-meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--content-2);
}
.panels {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel {
  padding: 16px 18px;
}
.panel-title {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--ink);
}
.panel-err {
  margin: 0;
  font-size: 12.5px;
  color: var(--red);
}
.kv {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.kv-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background: var(--bg-lilac);
  border-radius: 9px;
}
.kv-k {
  font-size: 11px;
  color: var(--content-2);
}
.kv-v {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.sub {
  margin-top: 14px;
}
.sub-cap {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--purple-meta);
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
  border: 1px solid var(--line);
  border-radius: 9px;
  font-size: 12.5px;
  color: var(--content);
}
.cell {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}
.cell em {
  font-style: normal;
  font-size: 11px;
  color: var(--content-2);
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  margin: 8px 0;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
