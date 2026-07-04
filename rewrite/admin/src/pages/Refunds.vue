<script setup lang="ts">
// 售后退款审批（M3 批2）：分栏计数 + 同意（两步确认·原路退回）/ 拒绝（原因必填）。
// 错误原文如实显示（调试案 A 现场就在这页——REFUND_TRIGGER_FAIL 等平台侧失败必须一眼可见）。
import { ref, onMounted } from 'vue'
import { listRefunds, refundCounts, approveRefund, rejectRefund } from '../api/money'
import { mapRefundRows, type RefundRowVM } from '../lib/mapMoney'

const TABS = [
  { key: 'applied', label: '待审核' },
  { key: 'approved', label: '退款处理中' },
  { key: 'refunded', label: '已退款' },
  { key: 'rejected', label: '已拒绝' },
  { key: '', label: '全部' },
]

const tab = ref('applied')
const counts = ref<Record<string, number>>({})
const rows = ref<RefundRowVM[]>([])
const message = ref('')
const busy = ref(false)
const approveConfirmId = ref('')
const rejectForm = ref<{ id: string; reason: string } | null>(null)

async function reload() {
  message.value = '加载中…'
  const [r, c] = await Promise.all([listRefunds(tab.value), refundCounts()])
  rows.value = r.ok ? mapRefundRows(r.list) : []
  if (c.ok && c.counts) counts.value = c.counts as Record<string, number>
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

function pickTab(k: string) {
  tab.value = k
  approveConfirmId.value = ''
  void reload()
}

async function doApprove(id: string) {
  if (busy.value) return
  if (approveConfirmId.value !== id) {
    approveConfirmId.value = id // 两步确认：真钱原路退回
    return
  }
  approveConfirmId.value = ''
  busy.value = true
  const r = await approveRefund(id)
  busy.value = false
  // 错误原文如实显示（含 REFUND_TRIGGER_FAIL——平台侧失败一眼可见·排障不再靠猜）
  message.value = r.ok ? '已受理，等微信回调确认到账' : `退款触发失败：${String(r.error || '')}`
  void reload()
}

async function doReject() {
  const f = rejectForm.value
  if (!f || busy.value) return
  if (!f.reason.trim()) {
    message.value = '拒绝必须写原因（会展示给买家）'
    return
  }
  busy.value = true
  const r = await rejectRefund(f.id, f.reason.trim())
  busy.value = false
  message.value = r.ok ? '' : '拒绝没成功：' + String(r.error || '')
  if (r.ok) rejectForm.value = null
  void reload()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>售后退款</h2>
    <div class="tabs">
      <button v-for="t in TABS" :key="t.key" :class="{ on: tab === t.key }" @click="pickTab(t.key)">
        {{ t.label }}<span v-if="counts[t.key || 'all'] != null">（{{ counts[t.key || 'all'] }}）</span>
      </button>
    </div>
    <p v-if="message" class="status">{{ message }}</p>

    <table v-if="rows.length">
      <thead>
        <tr><th>售后单</th><th>退什么</th><th>退多少</th><th>原因</th><th>状态</th><th>申请时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="mono">{{ row.orderId }}</td>
          <td>{{ row.what }}</td>
          <td class="mono amount">{{ row.refundAmountLabel }}</td>
          <td>{{ row.reason || '—' }}</td>
          <td>{{ row.statusLabel }}</td>
          <td>{{ row.timeLabel }}</td>
          <td>
            <template v-if="row.canDecide">
              <button class="act" :disabled="busy" @click="doApprove(row.id)">
                {{ approveConfirmId === row.id ? `确认退 ${row.refundAmountLabel}？` : '同意退款' }}
              </button>
              <button class="act ghost" @click="rejectForm = { id: row.id, reason: '' }">拒绝</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!message" class="status-soft">这一栏没有售后单</p>

    <div v-if="rejectForm" class="rejectbox">
      <h3>拒绝售后 · {{ rejectForm.id }}</h3>
      <input v-model="rejectForm.reason" maxlength="100" placeholder="拒绝原因（必填·买家可见）" />
      <div class="ops">
        <button class="act warn" :disabled="busy" @click="doReject">确认拒绝</button>
        <button class="act ghost" @click="rejectForm = null">取消</button>
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
  color: #c0392b;
}
.status-soft {
  font-size: 13px;
  color: var(--ld-purple-meta);
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
.amount {
  font-weight: 700;
  color: var(--ld-purple-ink);
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
  background: #c0392b;
}
.act:disabled {
  opacity: 0.5;
}
.rejectbox {
  margin-top: 18px;
  padding: 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 420px;
}
.rejectbox h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--ld-purple-ink);
}
.rejectbox input {
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.ops {
  display: flex;
  gap: 8px;
}
</style>
