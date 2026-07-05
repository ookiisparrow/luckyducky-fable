<script setup lang="ts">
// 订单发货（M3 批2）：状态分栏（计数走云端精确统计）+ 列表翻页 + 发货表单 + 金额不符挡/解除。
import { ref, onMounted } from 'vue'
import { listOrders, orderCounts, shipOrder, clearFeeMismatch } from '../api/money'
import { mapOrderRows, type OrderRowVM } from '../lib/mapMoney'

const TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待支付' },
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '已发货' },
  { key: 'done', label: '已完成' },
  { key: 'closed', label: '已关闭' },
]

const tab = ref('')
const counts = ref<Record<string, number>>({})
const rows = ref<OrderRowVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const message = ref('')
const shipForm = ref<{ id: string; company: string; trackingNo: string } | null>(null)
const busy = ref(false)

async function reload() {
  message.value = '加载中…'
  const [r, c] = await Promise.all([listOrders(tab.value), orderCounts()])
  rows.value = r.ok ? mapOrderRows(r.list) : []
  cursor.value = r.ok ? r.nextCursor : null
  hasMore.value = !!(r.ok && r.hasMore)
  if (c.ok && c.counts) counts.value = c.counts as Record<string, number>
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

async function more() {
  if (!hasMore.value || cursor.value == null) return
  const r = await listOrders(tab.value, cursor.value)
  if (!r.ok) return // 翻页失败不覆盖已有
  const seen = new Set(rows.value.map((x) => x.id))
  rows.value = [...rows.value, ...mapOrderRows(r.list).filter((x) => !seen.has(x.id))]
  cursor.value = r.nextCursor
  hasMore.value = !!r.hasMore
}

function pickTab(k: string) {
  tab.value = k
  void reload()
}

function openShip(row: OrderRowVM) {
  shipForm.value = { id: row.id, company: '', trackingNo: '' }
}

async function doShip() {
  const f = shipForm.value
  if (!f || busy.value) return
  if (!f.company.trim() || !f.trackingNo.trim()) {
    message.value = '快递公司和运单号都要填'
    return
  }
  busy.value = true
  const r = await shipOrder(f.id, f.company.trim(), f.trackingNo.trim())
  busy.value = false
  if (r.ok) {
    shipForm.value = null
    message.value = ''
    void reload()
  } else {
    message.value = `发货没成功（${String(r.error || '')}）` // 错误原文如实显示·不吞
  }
}

// 解除禁发走两步确认（禁原生 confirm——no-alert 纪律·承旧 admin utils/ui 精神的极简版）
const clearConfirmId = ref('')
async function doClearMismatch(id: string) {
  if (clearConfirmId.value !== id) {
    clearConfirmId.value = id // 第一步：按钮变「确认解除」
    return
  }
  clearConfirmId.value = ''
  const r = await clearFeeMismatch(id)
  message.value = r.ok ? '' : '解除失败：' + String(r.error || '')
  void reload()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>订单发货</h2>
    <div class="tabs">
      <button v-for="t in TABS" :key="t.key" :class="{ on: tab === t.key }" @click="pickTab(t.key)">
        {{ t.label }}<span v-if="counts[t.key || 'all'] != null">（{{ counts[t.key || 'all'] }}）</span>
      </button>
    </div>
    <p v-if="message" class="status">{{ message }}</p>

    <table v-if="rows.length">
      <thead>
        <tr><th>单号</th><th>商品</th><th>金额</th><th>状态</th><th>收货</th><th>时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ mismatch: row.feeMismatch }">
          <td class="mono">{{ row.id }}</td>
          <td>{{ row.summary }}（{{ row.count }} 件）</td>
          <td class="mono">{{ row.amountLabel }}</td>
          <td>
            {{ row.statusLabel }}
            <span v-if="row.feeMismatch" class="flag">金额不符·禁发</span>
            <span v-if="row.trackingNo" class="track">运单 {{ row.trackingNo }}</span>
          </td>
          <td class="addr">{{ row.address }}</td>
          <td>{{ row.timeLabel }}</td>
          <td>
            <button v-if="row.canShip" class="act" @click="openShip(row)">发货</button>
            <button v-if="row.feeMismatch" class="act warn" @click="doClearMismatch(row.id)">
              {{ clearConfirmId === row.id ? '确认已核对流水？' : '解除禁发' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!message" class="status">这一栏没有订单</p>
    <button v-if="hasMore" class="more" @click="more">加载更多</button>

    <div v-if="shipForm" class="shipbox">
      <h3>发货 · {{ shipForm.id }}</h3>
      <input v-model="shipForm.company" placeholder="快递公司（如 顺丰速运）" />
      <input v-model="shipForm.trackingNo" placeholder="运单号" />
      <div class="shipops">
        <button class="act" :disabled="busy" @click="doShip">确认发货</button>
        <button class="act ghost" @click="shipForm = null">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 16px;
  color: var(--ld-purple-ink);
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.tabs button {
  padding: 6px 14px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 999px;
  background: var(--ld-bg);
  cursor: pointer;
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.tabs button.on {
  color: var(--ld-purple-tab);
  font-weight: 600;
  background: var(--ld-bg-lilac);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  overflow: hidden;
}
th,
td {
  padding: 10px 12px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid var(--ld-bg-faint);
}
th {
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-meta);
  font-weight: 600;
}
.mono {
  font-family: ui-monospace, monospace;
}
.addr {
  max-width: 220px;
}
tr.mismatch {
  background: var(--ld-bg-red-soft);
}
.flag {
  margin-left: 6px;
  font-size: 11px;
  color: var(--ld-red);
}
.track {
  margin-left: 6px;
  font-size: 11px;
  color: var(--ld-purple-meta);
}
.act {
  padding: 5px 14px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  margin-right: 6px;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
}
.act.warn {
  background: var(--ld-red);
}
.more {
  margin-top: 14px;
  padding: 8px 24px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 999px;
  background: var(--ld-bg);
  cursor: pointer;
  font-size: 13px;
}
.shipbox {
  margin-top: 18px;
  padding: 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 420px;
}
.shipbox h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--ld-purple-ink);
}
.shipbox input {
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.shipops {
  display: flex;
  gap: 8px;
}
</style>
