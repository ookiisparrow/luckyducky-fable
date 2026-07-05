<script setup lang="ts">
// 财务对账（design/console.pen S16 视觉·M3 UI 批8）：内部对账（应收/退款/净额·全量精确 + 按日表·真值）
// + 外部微信官方账单逐笔勾对（四类差异·「微信有我方无」最危险标红——真对账口）+ 导出 CSV（客户端真生成）。
// 诚实边界：设计稿「微信手续费≈0.6% / 微信实际到账」为估算/结算数据，后端 getReconciliation 无——不伪造，
// 只渲染应收−退款=净额真等式；月份选择器（近 30 天固定窗，无 month 参数）与「导出 Excel」（改 CSV）记待办。
import { ref, computed, onMounted } from 'vue'
import { CircleDollarSign, RotateCcw, Wallet, Download, CircleCheck } from 'lucide-vue-next'
import { getReconciliation, getBillMatch, downloadBill } from '../api/system'
import { mapRecon, mapBillMatch, type ReconVM, type BillMatchVM } from '../lib/mapSystem'

const recon = ref<ReconVM | null>(null)
const match = ref<BillMatchVM | null>(null)
const message = ref('')
const billDate = ref('')
const busy = ref(false)
const from = ref('') // 自定义对账区间起（空=默认近 30 天窗）
const to = ref('')

// 窗内合计（所选区间真值·后端 summary 就绪·换皮误用 cumulative 全时值致口径错乱：窗内订单数与全时钱额混排、tfoot 穿帮）
const totals = computed(() => (recon.value ? recon.value.summary : null))
// 全账累计（money 锚·恒可信·横幅+顶部小条用）
const cum = computed(() => {
  if (!recon.value) return { income: '¥0.00', refund: '¥0.00', net: '¥0.00' }
  const find = (kw: string) => recon.value!.cumulative.find((c) => c.label.includes(kw))?.value || '¥0.00'
  return { income: find('收入'), refund: find('退款'), net: find('净额') }
})
// 内部异常总笔数（B2 修后·换皮误当数组恒 0·明细块永不渲染）
const exCount = computed(() => (recon.value ? recon.value.exceptions.reduce((n, e) => n + e.ids.length, 0) : 0))

async function reload() {
  message.value = '加载中…'
  const [r, m] = await Promise.all([getReconciliation(from.value, to.value), getBillMatch(from.value, to.value)])
  if ((r as any).error === 'SESSION_LOST' || (m as any).error === 'SESSION_LOST') return
  recon.value = mapRecon(r)
  match.value = mapBillMatch(m)
  message.value = recon.value || match.value ? '' : '加载失败：' + String((r as any).error || (m as any).error || '')
}

// 自定义对账区间（后端 from/to 就绪·换皮丢了这个·只能看死 30 天窗）
function applyRange() {
  const ok = (s: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!ok(from.value) || !ok(to.value)) {
    message.value = '日期格式 YYYY-MM-DD'
    return
  }
  void reload()
}
function clearRange() {
  from.value = ''
  to.value = ''
  void reload()
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

// CST 起止（含端）逐日列表（cap 62 天·防误填超长区间刷爆）
function daysBetween(a: string, b: string): string[] {
  const CST = 8 * 3600_000
  const s = Date.parse(a + 'T00:00:00+08:00')
  const e = Date.parse(b + 'T00:00:00+08:00')
  const out: string[] = []
  if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return out
  for (let t = s; t <= e && out.length < 62; t += 86400_000) out.push(new Date(t + CST).toISOString().slice(0, 10))
  return out
}

// 区间批量拉账单（换皮退成一次一天·核对一个月要手填 30 次）：按对账区间逐日 downloadBill 后刷新勾对。
// 区间空则默认近 30 天窗（与后端默认对齐）。
async function pullRange() {
  if (busy.value) return
  const CST = 8 * 3600_000
  const today = new Date(Date.now() + CST).toISOString().slice(0, 10)
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from.value) ? from.value : new Date(Date.now() - 29 * 86400_000 + CST).toISOString().slice(0, 10)
  const t = /^\d{4}-\d{2}-\d{2}$/.test(to.value) ? to.value : today
  const days = daysBetween(f, t)
  if (!days.length) {
    message.value = '区间不合法（起须早于止·YYYY-MM-DD）'
    return
  }
  busy.value = true
  let ok = 0
  for (let i = 0; i < days.length; i++) {
    message.value = `拉取账单 ${i + 1}/${days.length}（${days[i]}）…`
    const r = await downloadBill(days[i])
    if (r.ok) ok++
  }
  busy.value = false
  message.value = `区间账单已拉取 ${ok}/${days.length} 天，勾对已刷新`
  void reload()
}

function exportCsv() {
  if (!recon.value) return
  const head = '日期,订单数,应收GMV,退款,净额,退款笔数'
  const lines = recon.value.daily.map((d) => [d.day, d.orders, d.income, d.refund, d.net, d.refunds].join(','))
  const csv = [head, ...lines].join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = '财务对账-按日.csv'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>财务对账</h1>
        <p class="sub">应收 GMV、退款按日对账 + 微信官方账单逐笔勾对 · 资金对得上才安心（内部近 30 天窗）</p>
      </div>
      <button class="btn-primary" :disabled="!recon" @click="exportCsv">
        <Download :size="15" :stroke-width="1.8" /><span>导出 CSV</span>
      </button>
    </header>

    <div class="range">
      <label>对账区间</label>
      <input v-model="from" placeholder="起 YYYY-MM-DD" class="date-in" />
      <span class="dash">→</span>
      <input v-model="to" placeholder="止 YYYY-MM-DD" class="date-in" />
      <button class="range-btn" @click="applyRange">查询</button>
      <button v-if="from || to" class="range-clear" @click="clearRange">近 30 天</button>
      <span class="range-note">留空＝默认近 30 天窗</span>
    </div>

    <p v-if="message" class="status">{{ message }}</p>

    <template v-if="totals">
      <div class="balance" :class="{ warn: exCount }">
        <CircleCheck :size="20" :stroke-width="1.8" />
        <div>
          <div class="balance-t">{{ exCount ? `内部有 ${exCount} 笔异常待处理` : '内部账已对平' }}</div>
          <div class="balance-s">全账累计 应收 {{ cum.income }} − 退款 {{ cum.refund }} = 净额 {{ cum.net }}</div>
        </div>
      </div>

      <!-- 累计（全账·money 锚·恒可信·aggregate 全量精确·与下方区间窗口分开呈现·换皮把二者搅成一排致口径错乱） -->
      <div class="cum-strip">
        <div class="cum-item"><span>累计收入（全账）</span><b>{{ cum.income }}</b></div>
        <div class="cum-item"><span>累计退款（全账）</span><b>{{ cum.refund }}</b></div>
        <div class="cum-item"><span>累计净额（全账）</span><b>{{ cum.net }}</b></div>
      </div>

      <!-- 内部异常明细块（bug B2 修·换皮误当数组恒 0 永不渲染）：feeMismatch/refundMismatch/stuckRefunds 带单号 -->
      <div v-if="recon && recon.exceptions.length" class="ex-block">
        <h3 class="ex-h">内部异常明细（须人工处理）</h3>
        <div v-for="e in recon.exceptions" :key="e.label" class="ex-group">
          <div class="ex-label">{{ e.label }}（{{ e.ids.length }}）</div>
          <p v-for="id in e.ids" :key="id" class="ex-id">{{ id }}</p>
        </div>
      </div>

      <div class="range-cap">区间收支 · {{ recon && recon.range.from ? recon.range.from + ' ~ ' + recon.range.to : '近 30 天' }}</div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-head"><span class="stat-label">区间应收 GMV（已付）</span><CircleDollarSign class="stat-ico" :size="18" :stroke-width="1.8" /></div>
          <div class="stat-value">{{ totals.income }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-head"><span class="stat-label">区间退款合计</span><RotateCcw class="stat-ico amber" :size="18" :stroke-width="1.8" /></div>
          <div class="stat-value amber">{{ totals.refund }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-head"><span class="stat-label">区间净额（应收−退款）</span><Wallet class="stat-ico ok" :size="18" :stroke-width="1.8" /></div>
          <div class="stat-value ok">{{ totals.net }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-head"><span class="stat-label">区间已付订单数</span><CircleCheck class="stat-ico" :size="18" :stroke-width="1.8" /></div>
          <div class="stat-value">{{ totals.orders }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-head"><span class="stat-label">区间退款笔数</span><RotateCcw class="stat-ico amber" :size="18" :stroke-width="1.8" /></div>
          <div class="stat-value">{{ totals.refunds }}</div>
        </div>
      </div>

      <div v-if="recon && recon.approxNote" class="approx">{{ recon.approxNote }}</div>

      <div v-if="recon && recon.daily.length" class="table">
        <div class="thead">
          <span>日期</span><span class="r">订单数</span><span class="r">应收 GMV</span>
          <span class="r">退款</span><span class="r">净额</span><span class="r">退款笔数</span>
        </div>
        <div v-for="d in recon.daily" :key="d.day" class="trow">
          <span class="day">{{ d.day }}</span>
          <span class="r">{{ d.orders }}</span>
          <span class="r num">{{ d.income }}</span>
          <span class="r num" :class="{ amber: d.refund !== '¥0.00' }">{{ d.refund }}</span>
          <span class="r num strong">{{ d.net }}</span>
          <span class="r">{{ d.refunds }}</span>
        </div>
        <div class="trow total">
          <span class="day">窗内合计</span>
          <span class="r">{{ totals.orders }}</span>
          <span class="r num">{{ totals.income }}</span>
          <span class="r num amber">{{ totals.refund }}</span>
          <span class="r num strong">{{ totals.net }}</span>
          <span class="r">{{ totals.refunds }}</span>
        </div>
      </div>
    </template>

    <section v-if="match" class="ext-panel">
      <div class="ext-head">
        <h2>外部逐笔勾对 · 微信官方账单</h2>
        <span v-if="match.approxNote" class="approx-inline">{{ match.approxNote }}</span>
      </div>
      <div class="billrow">
        <input v-model="billDate" placeholder="拉某日账单 YYYY-MM-DD" />
        <button class="act" :disabled="busy" @click="pullBill">拉单日</button>
        <button class="act ghost" :disabled="busy" title="按上方对账区间逐日拉取（空=近 30 天）" @click="pullRange">拉整个区间</button>
      </div>
      <div class="ext-cards">
        <div v-for="s in match.summary" :key="s.label" class="ext-card" :class="{ danger: s.danger }">
          <div class="ext-k">{{ s.label }}</div>
          <div class="ext-v" :class="{ danger: s.danger }">{{ s.value }}</div>
        </div>
      </div>
      <template v-if="match.wxOnly.length">
        <h3 class="danger-h">微信收了钱、我方没单（立即人工核）</h3>
        <p v-for="w in match.wxOnly" :key="w.transactionId" class="row-line danger-line">{{ w.date }} · {{ w.transactionId }} · {{ w.amount }}</p>
      </template>
      <template v-if="match.amountMismatch.length">
        <h3 class="danger-h">金额不符</h3>
        <p v-for="mm in match.amountMismatch" :key="mm.id" class="row-line">{{ mm.id }} · 我方 {{ mm.ours }} ≠ 微信 {{ mm.wx }}</p>
      </template>
      <template v-if="match.oursOnly.length">
        <h3>我方有单微信无（多为账单未拉/未支付成功）</h3>
        <p v-for="o in match.oursOnly" :key="o.id" class="row-line">{{ o.id }} · {{ o.amount }}</p>
      </template>
    </section>
    <p class="foot-note">「微信手续费 / 实际到账」需微信结算数据源，后端暂无——本页只作应收/退款/净额真等式与账单逐笔勾对（区间可自选·全账累计恒为 money 锚）。</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
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
.btn-primary {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 10px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.5;
}
.status {
  font-size: 13px;
  color: var(--ld-content-2);
}
.range {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.date-in {
  padding: 7px 11px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--ld-bg);
  color: var(--ld-ink);
  font-family: var(--ld-font-mono);
  width: 148px;
}
.dash {
  color: var(--ld-content-2);
}
.range-btn {
  padding: 7px 16px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12.5px;
  cursor: pointer;
}
.range-clear {
  padding: 7px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content);
  font-size: 12.5px;
  cursor: pointer;
}
.range-note {
  font-size: 11px;
  color: var(--ld-content-2);
}
.balance.warn {
  background: var(--ld-bg-red-soft);
  border-color: var(--ld-red-line);
  color: var(--ld-red);
}
.ex-block {
  padding: 16px 20px;
  margin-bottom: 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-red-line);
  border-radius: var(--ld-radius-l);
}
.ex-h {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--ld-red);
}
.ex-group {
  margin-top: 8px;
}
.ex-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ld-content);
}
.ex-id {
  margin: 2px 0;
  font-size: 12px;
  font-family: var(--ld-font-mono);
  color: var(--ld-content-2);
}
.balance {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  margin-bottom: 18px;
  background: var(--ld-bg-green-soft);
  border: 1px solid var(--ld-green);
  border-radius: var(--ld-radius-l);
  color: var(--ld-green);
}
.balance-t {
  font-size: 14px;
  font-weight: 700;
}
.balance-s {
  margin-top: 3px;
  font-size: 12.5px;
  opacity: 0.9;
}
.cum-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  padding: 12px 20px;
  margin-bottom: 16px;
  background: var(--ld-bg-lilac);
  border-radius: var(--ld-radius-l);
}
.cum-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cum-item span {
  font-size: 11px;
  color: var(--ld-content-2);
}
.cum-item b {
  font-size: 16px;
  font-weight: 700;
  color: var(--ld-ink);
  font-variant-numeric: tabular-nums;
}
.range-cap {
  margin-bottom: 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-content-2);
}
.act.ghost {
  background: var(--ld-bg);
  color: var(--ld-content);
  border: 1px solid var(--ld-line);
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.stat-card {
  padding: 18px 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.stat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stat-label {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.stat-ico {
  color: var(--ld-brand);
}
.stat-ico.ok {
  color: var(--ld-green);
}
.stat-ico.amber {
  color: var(--ld-amber);
}
.stat-value {
  margin-top: 10px;
  font-size: 26px;
  font-weight: 700;
  color: var(--ld-ink);
  line-height: 1.1;
}
.stat-value.ok {
  color: var(--ld-green);
}
.stat-value.amber {
  color: var(--ld-amber);
}
.approx {
  margin-bottom: 10px;
  font-size: 11.5px;
  color: var(--ld-amber);
}
.table {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  overflow: hidden;
  margin-bottom: 18px;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1.2fr 1fr 1.2fr 1fr;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
}
.trow.total {
  background: var(--ld-bg-faint);
  font-weight: 700;
}
.r {
  text-align: right;
  justify-self: end;
}
.day {
  color: var(--ld-content);
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
}
.num {
  font-variant-numeric: tabular-nums;
  color: var(--ld-content);
}
.num.strong {
  font-weight: 700;
  color: var(--ld-ink);
}
.num.amber {
  color: var(--ld-amber);
}
.ext-panel {
  padding: 20px 22px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.ext-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}
.ext-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--ld-ink);
}
.approx-inline {
  font-size: 11px;
  color: var(--ld-amber);
}
.billrow {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.billrow input {
  padding: 8px 12px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 8px;
  font-size: 13px;
}
.ext-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}
.ext-card {
  padding: 12px 14px;
  background: var(--ld-bg-lilac);
  border-radius: 10px;
}
.ext-card.danger {
  background: var(--ld-bg-red-soft);
  border: 1px solid var(--ld-red-line);
}
.ext-k {
  font-size: 11px;
  color: var(--ld-content-2);
}
.ext-v {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 700;
  color: var(--ld-ink);
}
.ext-v.danger {
  color: var(--ld-red);
}
.danger-h {
  color: var(--ld-red);
  font-size: 13px;
  margin: 14px 0 6px;
}
.ext-panel h3 {
  font-size: 13px;
  color: var(--ld-content);
  margin: 14px 0 6px;
}
.row-line {
  font-size: 12.5px;
  font-family: var(--ld-font-mono);
  margin: 2px 0;
  color: var(--ld-content);
}
.danger-line {
  color: var(--ld-red);
}
.act {
  padding: 8px 18px;
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
.foot-note {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
</style>
