<script setup>
/**
 * 财务对账（S16·Batch 1 内部账）：收支汇总 + 每日流水 + 内部异常。
 *
 * 口径同看板 GMV（已付营收 paid/shipped/done）。三块：
 * - 累计（cumulative）：aggregate 精确求和·不封顶——money 锚，恒可信。
 * - 区间收支 + 每日流水：按所选日期范围（CST 日）；明细有界拉取，超量标「近似」（债#18 诚实范式）。
 * - 内部异常（exceptions）：金额不符 / 退款不符 / 退款卡单（与看板 txAlerts 同源）。
 *
 * 这是「我方账」自洽核对，抓内部不一致；抓不到「微信收了款我方无单」——那需逐笔比对微信支付账单
 * （外部对账·Batch 2/3·需商户 APIv3 凭证）。CSV 导出按当前每日流水。
 */
import { ref, computed } from 'vue'
import { cloudMode, getReconciliation } from '@/api/cloud.js'

const fmtDate = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const today = new Date()
const from = ref(fmtDate(new Date(today.getTime() - 29 * 86400000)))
const to = ref(fmtDate(today))

const data = ref(null)
const loading = ref(true)
const loadErr = ref('')

const yuan = (n) => '￥' + (Number(n) || 0).toFixed(2)
const exceptionCount = computed(() => {
  const e = data.value?.exceptions
  return !e ? 0 : (e.feeMismatch?.length || 0) + (e.refundMismatch?.length || 0) + (e.stuckRefunds?.length || 0)
})

async function load() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    data.value = await getReconciliation({ from: from.value, to: to.value })
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
load()

function exportCsv() {
  const rows = data.value?.daily || []
  if (!rows.length) return
  const head = ['日期', '收入(元)', '退款(元)', '净额(元)', '订单数', '退款数']
  const lines = [head.join(',')].concat(
    rows.map((r) => [r.day, r.income, r.refund, r.net, r.orders, r.refunds].join(',')),
  )
  // U+FEFF BOM 让 Excel 正确识别 UTF-8 中文（用 charCode 生成·避免源码里出现不可见字符）
  const bom = String.fromCharCode(0xfeff)
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `对账_${from.value}_${to.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>财务对账</h1>
        <p class="sub">收支汇总 · 每日流水 · 内部异常核对（已付营收口径）</p>
      </div>
      <button class="btn ghost" @click="load">↻ 刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">财务对账需云端模式。</p>
    <template v-else>
      <!-- 日期范围 -->
      <section class="range card">
        <label>区间</label>
        <input v-model="from" type="date" :max="to" />
        <span class="tilde">~</span>
        <input v-model="to" type="date" :max="fmtDate(today)" :min="from" />
        <button class="btn" @click="load">查询</button>
        <button class="btn ghost" :disabled="!data?.daily?.length" @click="exportCsv">导出 CSV</button>
      </section>

      <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
      <p v-else-if="loading" class="hint">统计中…</p>

      <template v-else-if="data">
        <!-- 累计（精确·money 锚） -->
        <div class="cards">
          <div class="stat card accent">
            <div class="num">{{ yuan(data.cumulative.income) }}</div>
            <div class="lbl">累计收入（已付营收·精确）</div>
          </div>
          <div class="stat card">
            <div class="num">{{ yuan(data.cumulative.refund) }}</div>
            <div class="lbl">累计退款</div>
          </div>
          <div class="stat card">
            <div class="num">{{ yuan(data.cumulative.net) }}</div>
            <div class="lbl">累计净额（收入−退款）</div>
          </div>
        </div>

        <!-- 区间收支 -->
        <div class="card col summary">
          <h3>
            区间收支 · {{ data.range.from }} ~ {{ data.range.to }}
            <span v-if="data.approx" class="dim">（明细近似·数据量超上限截断）</span>
          </h3>
          <div class="sum-grid">
            <div><b>{{ yuan(data.summary.income) }}</b><span>收入</span></div>
            <div><b>{{ yuan(data.summary.refund) }}</b><span>退款</span></div>
            <div><b>{{ yuan(data.summary.net) }}</b><span>净额</span></div>
            <div><b>{{ data.summary.orders }}</b><span>订单笔数</span></div>
            <div><b>{{ data.summary.refunds }}</b><span>退款笔数</span></div>
          </div>
        </div>

        <!-- 每日流水表 -->
        <div class="card col">
          <h3>每日流水</h3>
          <p v-if="!data.daily.length" class="empty">所选区间没有收支记录</p>
          <table v-else class="flow">
            <thead>
              <tr><th>日期</th><th class="r">收入</th><th class="r">退款</th><th class="r">净额</th><th class="r">订单</th><th class="r">退款笔</th></tr>
            </thead>
            <tbody>
              <tr v-for="d in data.daily" :key="d.day">
                <td>{{ d.day }}</td>
                <td class="r">{{ yuan(d.income) }}</td>
                <td class="r refund">{{ d.refund ? '−' + yuan(d.refund).slice(1) : '—' }}</td>
                <td class="r net">{{ yuan(d.net) }}</td>
                <td class="r">{{ d.orders }}</td>
                <td class="r">{{ d.refunds }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 内部异常 -->
        <div class="card col exceptions" :class="{ clear: !exceptionCount }">
          <h3>对账异常 · 内部不一致（{{ exceptionCount }}）</h3>
          <p v-if="!exceptionCount" class="ok-line">✓ 我方账内部一致，无异常单</p>
          <template v-else>
            <p v-if="data.exceptions.feeMismatch.length" class="alert-line">
              支付金额异常单（去「订单发货」复核解除）：{{ data.exceptions.feeMismatch.join('、') }}
            </p>
            <p v-if="data.exceptions.refundMismatch.length" class="alert-line">
              退款金额不符（去商户平台核对流水）：{{ data.exceptions.refundMismatch.join('、') }}
            </p>
            <p v-if="data.exceptions.stuckRefunds.length" class="alert-line">
              退款已触发超 1 小时未回调（商户平台查退款进度）：{{ data.exceptions.stuckRefunds.join('、') }}
            </p>
          </template>
        </div>

        <p class="defer">
          以上为「我方账」自洽核对。逐笔比对微信支付官方账单（抓「微信有款我方无单」）属外部对账，
          需商户 APIv3 凭证，列后续批次。
        </p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
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
.range {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  margin-bottom: 18px;
}
.range label {
  font-size: 12.5px;
  color: var(--content-2);
}
.range input[type='date'] {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  color: var(--ink);
}
.tilde {
  color: var(--content-2);
}
.btn {
  border: 1px solid var(--brand);
  background: var(--brand);
  color: #fff;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 12.5px;
  cursor: pointer;
}
.btn.ghost {
  background: none;
  color: var(--content-2);
  border-color: var(--line);
}
.btn.ghost:disabled {
  opacity: 0.5;
  cursor: default;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}
.stat {
  padding: 18px 20px;
}
.stat.accent {
  border-color: var(--purple-line);
  background: var(--bg-lilac);
}
.num {
  font-size: 26px;
  font-weight: 700;
  color: var(--ink);
}
.lbl {
  font-size: 12px;
  color: var(--content-2);
  margin-top: 4px;
}
.dim {
  font-size: 11px;
  color: var(--content-2);
  font-weight: 400;
}
.col {
  padding: 16px 20px;
  margin-bottom: 18px;
}
.col h3 {
  font-size: 13.5px;
  color: var(--ink);
  margin: 0 0 12px;
}
.sum-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 14px;
}
.sum-grid div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sum-grid b {
  font-size: 18px;
  color: var(--ink);
}
.sum-grid span {
  font-size: 11.5px;
  color: var(--content-2);
}
.flow {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.flow th {
  text-align: left;
  font-weight: 600;
  color: var(--content-2);
  font-size: 11.5px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
}
.flow td {
  padding: 8px;
  border-bottom: 1px solid var(--line);
  color: var(--content);
}
.flow .r {
  text-align: right;
}
.flow .net {
  color: var(--ink);
  font-weight: 600;
}
.flow .refund {
  color: var(--content-2);
}
.empty {
  font-size: 12px;
  color: var(--content-2);
  padding: 10px 0;
}
.exceptions {
  border-color: #f0c8c5;
  background: #fdf0ef;
}
.exceptions.clear {
  border-color: var(--line);
  background: var(--white);
}
.alert-line {
  margin: 4px 0;
  font-size: 12.5px;
  color: var(--red);
}
.ok-line {
  margin: 0;
  font-size: 12.5px;
  color: var(--green);
}
.defer {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--content-2);
  line-height: 1.6;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
