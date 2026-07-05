<script setup lang="ts">
// 财务对账（M3 批6）：内部累计（收入−退款=净额·全量精确）+ 按日分桶 + 外部逐笔勾对
// （微信官方账单 ⋈ 我方付款单·四类差异·「微信有我方无」最危险标红）+ 拉某日账单。
import { ref, onMounted } from 'vue'
import { getReconciliation, getBillMatch, downloadBill } from '../api/system'
import { mapRecon, mapBillMatch, type ReconVM, type BillMatchVM } from '../lib/mapSystem'

const recon = ref<ReconVM | null>(null)
const match = ref<BillMatchVM | null>(null)
const message = ref('')
const billDate = ref('')
const busy = ref(false)

async function reload() {
  message.value = '加载中…'
  const [r, m] = await Promise.all([getReconciliation(), getBillMatch()])
  recon.value = mapRecon(r)
  match.value = mapBillMatch(m)
  message.value = recon.value || match.value ? '' : '加载失败：' + String(r.error || m.error || '')
}

async function pullBill() {
  if (busy.value || !/^\d{4}-\d{2}-\d{2}$/.test(billDate.value)) {
    message.value = billDate.value ? '日期格式 YYYY-MM-DD' : '先填日期'
    return
  }
  busy.value = true
  const r = await downloadBill(billDate.value)
  busy.value = false
  message.value = r.ok ? '账单已拉取入库，勾对已刷新' : '拉取失败：' + String(r.error || '')
  void reload()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>财务对账</h2>
    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="recon" class="panel">
      <h3>内部对账（全量精确）<span v-if="recon.approxNote" class="warn-note">{{ recon.approxNote }}</span></h3>
      <div class="cards">
        <div v-for="c in recon.cumulative" :key="c.label" class="card">
          <div class="k">{{ c.label }}</div>
          <div class="v">{{ c.value }}</div>
        </div>
      </div>
      <table v-if="recon.daily.length">
        <thead><tr><th>日期</th><th>收入</th><th>退款</th><th>净额</th><th>单数</th><th>退款笔数</th></tr></thead>
        <tbody>
          <tr v-for="d in recon.daily" :key="d.day">
            <td>{{ d.day }}</td><td>{{ d.income }}</td><td>{{ d.refund }}</td><td>{{ d.net }}</td><td>{{ d.orders }}</td><td>{{ d.refunds }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="match" class="panel">
      <h3>外部逐笔勾对（微信官方账单）<span v-if="match.approxNote" class="warn-note">{{ match.approxNote }}</span></h3>
      <div class="billrow">
        <input v-model="billDate" placeholder="拉某日账单 YYYY-MM-DD" />
        <button class="act" :disabled="busy" @click="pullBill">拉取账单</button>
      </div>
      <div class="cards">
        <div v-for="s in match.summary" :key="s.label" class="card" :class="{ danger: s.danger }">
          <div class="k">{{ s.label }}</div>
          <div class="v">{{ s.value }}</div>
        </div>
      </div>
      <template v-if="match.wxOnly.length">
        <h4 class="danger-h">微信收了钱、我方没单（立即人工核）</h4>
        <p v-for="w in match.wxOnly" :key="w.transactionId" class="row-line danger-line">{{ w.date }} · {{ w.transactionId }} · {{ w.amount }}</p>
      </template>
      <template v-if="match.amountMismatch.length">
        <h4 class="danger-h">金额不符</h4>
        <p v-for="m in match.amountMismatch" :key="m.id" class="row-line">{{ m.id }} · 我方 {{ m.ours }} ≠ 微信 {{ m.wx }}</p>
      </template>
      <template v-if="match.oursOnly.length">
        <h4>我方有单微信无（多为账单未拉/未支付成功）</h4>
        <p v-for="o in match.oursOnly" :key="o.id" class="row-line">{{ o.id }} · {{ o.amount }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
h3 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--ld-purple-ink);
}
h4 {
  margin: 14px 0 6px;
  font-size: 13px;
  color: var(--ld-purple-ink);
}
.danger-h {
  color: var(--ld-red);
}
.warn-note {
  margin-left: 8px;
  font-size: 11px;
  color: var(--ld-amber);
  font-weight: 400;
}
.status {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.panel {
  padding: 16px 18px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
.cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.card {
  min-width: 130px;
  padding: 12px 14px;
  background: var(--ld-bg-lilac);
  border-radius: 10px;
}
.card.danger {
  background: var(--ld-bg-red-soft);
  border: 1px solid var(--ld-red-line);
}
.card .k {
  font-size: 11px;
  color: var(--ld-purple-meta);
}
.card .v {
  font-size: 20px;
  font-weight: 700;
  color: var(--ld-purple-ink);
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 8px 10px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid var(--ld-bg-faint);
}
th {
  color: var(--ld-purple-meta);
}
.billrow {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.billrow input {
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.row-line {
  font-size: 13px;
  font-family: ui-monospace, monospace;
  margin: 2px 0;
}
.danger-line {
  color: var(--ld-red);
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
.act:disabled {
  opacity: 0.5;
}
</style>
