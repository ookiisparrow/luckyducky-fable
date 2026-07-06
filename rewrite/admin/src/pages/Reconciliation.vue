<script setup lang="ts">
// 财务对账（design/console.pen S16 视觉·M3 UI 批8）：内部对账（应收/退款/净额·全量精确 + 按日表·真值）
// + 外部微信官方账单逐笔勾对（四类差异·「微信有我方无」最危险标红——真对账口）+ 导出 CSV（客户端真生成）。
// 诚实边界：设计稿「微信手续费≈0.6% / 微信实际到账」为估算/结算数据，后端 getReconciliation 无——不伪造，
// 只渲染应收−退款=净额真等式；月份选择器（近 30 天固定窗，无 month 参数）与「导出 Excel」（改 CSV）记待办。
import { ref, computed, onMounted } from 'vue'
import { CircleDollarSign, RotateCcw, Wallet, Download, CircleCheck } from 'lucide-vue-next'
import { getReconciliation, getBillMatch, downloadBill } from '../api/system'
import { mapRecon, mapBillMatch, type ReconVM, type BillMatchVM } from '../lib/mapSystem'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

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
  <div class="ld-page">
    <PageHeader title="财务对账" sub="应收 GMV、退款按日对账 + 微信官方账单逐笔勾对 · 资金对得上才安心（内部近 30 天窗）">
      <UiButton :disabled="!recon" @click="exportCsv">
        <Download :size="15" :stroke-width="1.8" /><span>导出 CSV</span>
      </UiButton>
    </PageHeader>

    <!-- 对账区间筛选 -->
    <div class="ld-toolbar">
      <span class="range-label">对账区间</span>
      <label class="ld-search"><input v-model="from" placeholder="起 YYYY-MM-DD" /></label>
      <span class="dash">→</span>
      <label class="ld-search"><input v-model="to" placeholder="止 YYYY-MM-DD" /></label>
      <UiButton size="sm" @click="applyRange">查询</UiButton>
      <UiButton v-if="from || to" size="sm" variant="ghost" @click="clearRange">近 30 天</UiButton>
      <span class="range-note">留空＝默认近 30 天窗</span>
    </div>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <template v-if="totals">
      <!-- 账平/异常横幅（全账累计等式·真值） -->
      <div class="balance" :class="{ warn: exCount }">
        <CircleCheck :size="20" :stroke-width="1.8" />
        <div>
          <div class="balance-t">{{ exCount ? `内部有 ${exCount} 笔异常待处理` : '内部账已对平' }}</div>
          <div class="balance-s">全账累计 应收 {{ cum.income }} − 退款 {{ cum.refund }} = 净额 {{ cum.net }}</div>
        </div>
      </div>

      <!-- 全账累计（money 锚·恒可信·aggregate 全量精确·与下方区间窗口口径分开呈现） -->
      <div class="kpi-block">
        <div class="cap">全账累计 · 全时精确</div>
        <div class="ld-kpi-grid">
          <KpiCard label="累计收入（全账）" :value="cum.income" :icon="CircleDollarSign" />
          <KpiCard label="累计退款（全账）" :value="cum.refund" :icon="RotateCcw" />
          <KpiCard label="累计净额（全账）" :value="cum.net" :icon="Wallet" />
        </div>
      </div>

      <!-- 内部异常明细（feeMismatch/refundMismatch/stuckRefunds 带单号·须人工处理） -->
      <Card v-if="recon && recon.exceptions.length" title="内部异常明细" sub="须人工处理">
        <template #head><Badge tone="red">{{ exCount }} 笔</Badge></template>
        <div v-for="e in recon.exceptions" :key="e.label" class="ex-group">
          <div class="ex-label">{{ e.label }}（{{ e.ids.length }}）</div>
          <p v-for="id in e.ids" :key="id" class="ex-id">{{ id }}</p>
        </div>
      </Card>

      <!-- 区间收支 KPI（所选区间真值） -->
      <div class="kpi-block">
        <div class="cap">区间收支 · {{ recon && recon.range.from ? recon.range.from + ' ~ ' + recon.range.to : '近 30 天' }}</div>
        <div class="ld-kpi-grid">
          <KpiCard label="区间应收 GMV（已付）" :value="totals.income" :icon="CircleDollarSign" />
          <KpiCard label="区间退款合计" :value="totals.refund" :icon="RotateCcw" />
          <KpiCard label="区间净额（应收−退款）" :value="totals.net" :icon="Wallet" />
          <KpiCard label="区间已付订单数" :value="totals.orders" :icon="CircleCheck" />
          <KpiCard label="区间退款笔数" :value="totals.refunds" :icon="RotateCcw" />
        </div>
        <div v-if="recon && recon.approxNote" class="approx">{{ recon.approxNote }}</div>
      </div>

      <!-- 逐日对账表（含窗内合计行·真值） -->
      <Card v-if="recon && recon.daily.length" title="逐日对账" flush>
        <div class="ld-table">
          <div class="ld-thead">
            <div class="ld-th grow">日期</div>
            <div class="ld-th r" :style="{ width: '90px' }">订单数</div>
            <div class="ld-th r" :style="{ width: '130px' }">应收 GMV</div>
            <div class="ld-th r" :style="{ width: '120px' }">退款</div>
            <div class="ld-th r" :style="{ width: '130px' }">净额</div>
            <div class="ld-th r" :style="{ width: '100px' }">退款笔数</div>
          </div>
          <div class="ld-tbody">
            <div v-for="d in recon.daily" :key="d.day" class="ld-tr">
              <div class="ld-td grow mono">{{ d.day }}</div>
              <div class="ld-td r" :style="{ width: '90px' }">{{ d.orders }}</div>
              <div class="ld-td r num" :style="{ width: '130px' }">{{ d.income }}</div>
              <div class="ld-td r num" :class="{ amber: d.refund !== '¥0.00' }" :style="{ width: '120px' }">{{ d.refund }}</div>
              <div class="ld-td r num strong" :style="{ width: '130px' }">{{ d.net }}</div>
              <div class="ld-td r" :style="{ width: '100px' }">{{ d.refunds }}</div>
            </div>
            <div class="ld-tr total">
              <div class="ld-td grow mono">窗内合计</div>
              <div class="ld-td r" :style="{ width: '90px' }">{{ totals.orders }}</div>
              <div class="ld-td r num" :style="{ width: '130px' }">{{ totals.income }}</div>
              <div class="ld-td r num amber" :style="{ width: '120px' }">{{ totals.refund }}</div>
              <div class="ld-td r num strong" :style="{ width: '130px' }">{{ totals.net }}</div>
              <div class="ld-td r" :style="{ width: '100px' }">{{ totals.refunds }}</div>
            </div>
          </div>
        </div>
      </Card>
    </template>

    <!-- 外部逐笔勾对 · 微信官方账单 -->
    <Card v-if="match" title="外部逐笔勾对 · 微信官方账单">
      <p v-if="match.approxNote" class="approx-inline">{{ match.approxNote }}</p>

      <div class="ld-toolbar bill-row">
        <label class="ld-search wide"><input v-model="billDate" placeholder="拉某日账单 YYYY-MM-DD" /></label>
        <UiButton size="sm" :disabled="busy" @click="pullBill">拉单日</UiButton>
        <UiButton size="sm" variant="ghost" :disabled="busy" title="按上方对账区间逐日拉取（空=近 30 天）" @click="pullRange">拉整个区间</UiButton>
      </div>

      <div class="ld-kpi-grid ext-sum">
        <KpiCard v-for="s in match.summary" :key="s.label" :label="s.label" :value="s.value" :tone="s.danger ? 'red' : 'neutral'" />
      </div>

      <!-- 微信收了钱、我方没单（最危险·立即人工核） -->
      <template v-if="match.wxOnly.length">
        <div class="sub-h danger">
          <span>微信收了钱、我方没单</span><span class="sub-note">最危险 · 立即人工核</span><Badge tone="red">{{ match.wxOnly.length }} 笔</Badge>
        </div>
        <div class="ld-table">
          <div class="ld-thead">
            <div class="ld-th grow">日期</div>
            <div class="ld-th" :style="{ width: '220px' }">微信交易号</div>
            <div class="ld-th r" :style="{ width: '120px' }">金额</div>
          </div>
          <div class="ld-tbody">
            <div v-for="w in match.wxOnly" :key="w.transactionId" class="ld-tr">
              <div class="ld-td grow mono">{{ w.date }}</div>
              <div class="ld-td mono" :style="{ width: '220px' }">{{ w.transactionId }}</div>
              <div class="ld-td r num danger" :style="{ width: '120px' }">{{ w.amount }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- 金额不符 -->
      <template v-if="match.amountMismatch.length">
        <div class="sub-h"><span>金额不符</span><Badge tone="amber">{{ match.amountMismatch.length }} 笔</Badge></div>
        <div class="ld-table">
          <div class="ld-thead">
            <div class="ld-th grow">单号</div>
            <div class="ld-th r" :style="{ width: '130px' }">我方</div>
            <div class="ld-th r" :style="{ width: '130px' }">微信</div>
          </div>
          <div class="ld-tbody">
            <div v-for="mm in match.amountMismatch" :key="mm.id" class="ld-tr">
              <div class="ld-td grow mono">{{ mm.id }}</div>
              <div class="ld-td r num" :style="{ width: '130px' }">{{ mm.ours }}</div>
              <div class="ld-td r num amber" :style="{ width: '130px' }">{{ mm.wx }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- 我方有单微信无 -->
      <template v-if="match.oursOnly.length">
        <div class="sub-h"><span>我方有单微信无</span><span class="sub-note">多为账单未拉/未支付成功</span><Badge tone="neutral">{{ match.oursOnly.length }} 笔</Badge></div>
        <div class="ld-table">
          <div class="ld-thead">
            <div class="ld-th grow">单号</div>
            <div class="ld-th r" :style="{ width: '130px' }">金额</div>
          </div>
          <div class="ld-tbody">
            <div v-for="o in match.oursOnly" :key="o.id" class="ld-tr">
              <div class="ld-td grow mono">{{ o.id }}</div>
              <div class="ld-td r num" :style="{ width: '130px' }">{{ o.amount }}</div>
            </div>
          </div>
        </div>
      </template>

      <EmptyState v-if="!match.wxOnly.length && !match.amountMismatch.length && !match.oursOnly.length" :icon="CircleCheck" text="逐笔已勾对 · 无差异" />
    </Card>

    <p class="foot-note">「微信手续费 / 实际到账」需微信结算数据源，后端暂无——本页只作应收/退款/净额真等式与账单逐笔勾对（区间可自选·全账累计恒为 money 锚）。</p>
  </div>
</template>

<style scoped>
/* 区间筛选条内的说明文字（工具条/搜索框/按钮走 kit） */
.range-label {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.dash {
  color: var(--ld-content-2);
}
.range-note {
  font-size: 11px;
  color: var(--ld-content-2);
}
.ld-toolbar .ld-search input {
  font-family: var(--ld-font-mono);
}
.ld-search.wide input {
  min-width: 210px;
}

/* 账平/异常横幅（本页独有语义块） */
.balance {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: var(--ld-bg-green-soft);
  border: 1px solid var(--ld-green);
  border-radius: var(--ld-radius);
  color: var(--ld-green);
}
.balance.warn {
  background: var(--ld-bg-red-soft);
  border-color: var(--ld-red-line);
  color: var(--ld-red);
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

/* KPI 分组：小标题紧贴其网格（全账/区间口径分开呈现） */
.kpi-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cap {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-content-2);
}
.approx {
  margin: 0;
  font-size: 11.5px;
  color: var(--ld-amber);
}

/* 内部异常明细行（外壳走 Card） */
.ex-group {
  margin-top: 10px;
}
.ex-group:first-child {
  margin-top: 0;
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

/* 表格单元修饰（右对齐/等宽数字/强调/异常·外壳走 .ld-table） */
.ld-th.r,
.ld-td.r {
  justify-content: flex-end;
  text-align: right;
}
.ld-td.mono {
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
}
.ld-td.num {
  font-variant-numeric: tabular-nums;
}
.ld-td.strong {
  font-weight: 700;
  color: var(--ld-ink);
}
.ld-td.amber {
  color: var(--ld-amber);
}
.ld-td.danger {
  color: var(--ld-red);
  font-weight: 600;
}
.ld-tr.total {
  background: var(--ld-bg-faint);
  font-weight: 700;
}

/* 外部账单核对面板内的说明/子表头（外壳走 Card） */
.approx-inline {
  margin: 0 0 12px;
  font-size: 11.5px;
  color: var(--ld-amber);
}
.bill-row {
  margin-bottom: 14px;
}
.ext-sum {
  margin-bottom: 14px;
}
.sub-h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ld-content);
}
.sub-h.danger {
  color: var(--ld-red);
}
.sub-note {
  font-size: 11.5px;
  font-weight: 400;
  color: var(--ld-content-2);
}
.foot-note {
  margin: 0;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
</style>
