<script setup lang="ts">
// 发货工作台（换皮回归还原批·1:1 承接旧线 packages/admin/src/pages/Fulfill.vue + fulfill/Step*.vue）：
// ①拣货备货（全部待发货按产品汇总）②打印内部标签（QR=订单id 贴箱）③扫码发货（扫箱码选单+扫快递码发货）。
// 三步是同一物理队列（全部待发货）的三个视图·数字互相咬合；新付款单只在点「刷新队列」时进队。
// 新线单页三段（旧线是路由 /fulfill/step/:n + <component :is>）；no-alert：内联状态行代替 toast。
import { ref, computed, nextTick, onMounted } from 'vue'
import QRCode from 'qrcode'
import { RefreshCw, ScanLine, Printer, Package } from 'lucide-vue-next'
import { listOrders, shipOrder } from '../api/money'
import { mapOrderRows, type OrderRowVM } from '../lib/mapMoney'
import {
  FULFILL_STEP_NAMES,
  COMPANIES,
  PAPER_PRESETS,
  pickSummary,
  labelData,
  buildLabelHtml,
  classifyScan,
  shortCode,
  type FulfillOrder,
  type PrintLabel,
} from '../lib/fulfill'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

// —— 队列（壳持有·传给三步）——
const step = ref(1)
const orders = ref<FulfillOrder[]>([])
const loading = ref(true)
const loadErr = ref('')
// 本次发货流水（会话态·跳步不丢·刷新页面即清）
interface LogEntry {
  id: string
  time: number
  code: string
  name: string
  trackingNo: string
  company: string
  ok: boolean
  msg?: string
}
const sessionLog = ref<LogEntry[]>([])

async function reload() {
  loading.value = true
  loadErr.value = ''
  try {
    // 游标循环拉全量 paid（每页服务端上限·25 页保险丝防异常数据无限翻页）
    const acc: FulfillOrder[] = []
    const seen = new Set<string>()
    let cursor: unknown = undefined
    let hasMore = true
    let pages = 0
    while (hasMore && pages < 25) {
      const r = await listOrders('paid', cursor, 200)
      if (!r.ok) {
        loadErr.value = '加载待发货订单失败：' + String(r.error || '')
        break
      }
      for (const o of mapOrderRows((r as any).list) as OrderRowVM[]) {
        if (seen.has(o.id)) continue
        seen.add(o.id)
        // OrderRowVM 已带 addr*/items·转 FulfillOrder 形状（含 feeMismatch）
        acc.push({
          id: o.id,
          createdAt: o.createdAtMs || 0,
          feeMismatch: o.feeMismatch,
          items: o.items.map((it) => ({ name: it.name, qty: it.qty })),
          address: { name: o.addrName, phone: o.addrPhone, region: o.addrRegion, detail: o.addrDetail },
        })
      }
      cursor = (r as any).nextCursor
      hasMore = !!(r as any).hasMore && cursor != null
      pages++
    }
    orders.value = acc
  } catch (e) {
    loadErr.value = '加载失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}
onMounted(reload)

const summary = computed(() => pickSummary(orders.value))
const fmtTime = (ts?: number) => {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// —— 步2 打印 ——
const PRINTED_KEY = 'ldrw-fulfill-printed'
const PAPER_KEY = 'ldrw-fulfill-paper'
function loadPrinted(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(PRINTED_KEY) || '[]')
    return new Set(Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
const printed = ref<Set<string>>(loadPrinted())
function savePrinted() {
  const alive = new Set(orders.value.map((o) => o.id))
  localStorage.setItem(PRINTED_KEY, JSON.stringify([...printed.value].filter((id) => id && alive.has(id))))
}
function togglePrinted(id: string) {
  const s = new Set(printed.value)
  s.has(id) ? s.delete(id) : s.add(id)
  printed.value = s
  savePrinted()
}
const savedPaper = localStorage.getItem(PAPER_KEY) || PAPER_PRESETS[0].key
const paperKey = ref(PAPER_PRESETS.some((p) => p.key === savedPaper) ? savedPaper : PAPER_PRESETS[0].key)
const preset = computed(() => PAPER_PRESETS.find((p) => p.key === paperKey.value) || PAPER_PRESETS[0])
function onPaperChange() {
  localStorage.setItem(PAPER_KEY, paperKey.value)
}
const checked = ref<Set<string>>(new Set())
function syncDefaultChecked() {
  checked.value = new Set(orders.value.filter((o) => !printed.value.has(o.id as string)).map((o) => o.id as string))
}
function toggleCheck(id: string) {
  const s = new Set(checked.value)
  s.has(id) ? s.delete(id) : s.add(id)
  checked.value = s
}
function selectAll() {
  checked.value = new Set(orders.value.map((o) => o.id as string))
}
function selectUnprinted() {
  checked.value = new Set(orders.value.filter((o) => !printed.value.has(o.id as string)).map((o) => o.id as string))
}
const chosen = computed(() => orders.value.filter((o) => checked.value.has(o.id as string)))
const previewId = ref('')
const previewQr = ref('')
const previewLabel = computed(() => {
  const o = orders.value.find((x) => x.id === previewId.value)
  return o ? labelData(o) : null
})
async function openPreview(o: FulfillOrder) {
  previewId.value = o.id as string
  previewQr.value = await QRCode.toDataURL(o.id as string, { width: 300, margin: 1 })
}
const printing = ref(false)
const printMsg = ref('')
async function doPrint() {
  if (printing.value || !chosen.value.length) return
  printing.value = true
  printMsg.value = ''
  try {
    const labels: PrintLabel[] = await Promise.all(
      chosen.value.map(async (o) => ({ ...labelData(o), qrDataUrl: await QRCode.toDataURL(o.id as string, { width: 300, margin: 1 }) })),
    )
    const w = window.open('', '_blank')
    if (!w) {
      printMsg.value = '浏览器拦截了打印窗口，请允许本站弹窗后重试'
      return
    }
    w.document.write(buildLabelHtml(labels, preset.value))
    w.document.close()
    w.onload = () => {
      w.focus()
      w.print()
    }
    const s = new Set(printed.value)
    labels.forEach((l) => s.add(l.id))
    printed.value = s
    savePrinted()
    printMsg.value = `已生成 ${labels.length} 张标签，打印后贴箱、照清单装货`
  } finally {
    printing.value = false
  }
}

// —— 步3 扫码发货 ——
const COMPANY_KEY = 'ldrw-fulfill-company'
const savedCompany = localStorage.getItem(COMPANY_KEY) || ''
const company = ref(COMPANIES.includes(savedCompany) ? savedCompany : COMPANIES[0])
function onCompanyChange() {
  localStorage.setItem(COMPANY_KEY, company.value)
  focusScan()
}
const idSet = computed(() => new Set(orders.value.map((o) => o.id as string)))
const scanEl = ref<HTMLInputElement | null>(null)
const scanText = ref('')
const focused = ref(false)
function focusScan() {
  nextTick(() => scanEl.value?.focus())
}
const selected = ref<FulfillOrder | null>(null)
const selectedLabel = computed(() => (selected.value ? labelData(selected.value) : null))
const shipping = ref(false)
const scanMsg = ref('')
const scanMsgBad = ref(false)
function say(msg: string, bad = false) {
  scanMsg.value = msg
  scanMsgBad.value = bad
}
function onScan() {
  const res = classifyScan(scanText.value, idSet.value)
  scanText.value = ''
  if (res.type === 'empty') return
  if (res.type === 'order') {
    selected.value = orders.value.find((o) => o.id === res.id) || null
    say('')
    return
  }
  if (res.type === 'order-not-in-queue') {
    const inLog = sessionLog.value.find((e) => e.id === res.id && e.ok)
    say(
      inLog
        ? `这单刚已发货（${shortCode(res.id)}），别重复装箱`
        : `这张码不在待发货队列（可能已发货或未支付）：${shortCode(res.id)}，去「订单发货」页搜单号核实`,
      true,
    )
    return
  }
  if (!selected.value) {
    say('先扫箱上的内部二维码选中订单，再扫快递面单条码', true)
    return
  }
  if (selected.value.feeMismatch) {
    say('金额异常单：先到「订单发货」页核对流水解除，再回来扫码发', true)
    return
  }
  void doShip(selected.value, res.trackingNo)
}
function mapShipErr(msg: string) {
  if (msg === 'FEE_MISMATCH_HOLD') return '金额异常单被挡下：先到「订单发货」页核对流水解除'
  if (msg === 'BAD_STATUS:shipped') return '这单已发过货；要改运单号请去「订单发货」页'
  if (msg && msg.startsWith('BAD_STATUS:')) return `这单当前状态（${msg.slice(11)}）不能发货`
  if (msg === 'NO_ORDER') return '找不到这单订单'
  return `发货失败：${msg}`
}
async function doShip(order: FulfillOrder, trackingNo: string) {
  if (shipping.value) return
  shipping.value = true
  const time = Date.now()
  const code = shortCode(order.id)
  const name = order.address?.name || '—'
  const r = await shipOrder(order.id as string, company.value, trackingNo)
  shipping.value = false
  if (r.ok) {
    orders.value = orders.value.filter((o) => o.id !== order.id)
    sessionLog.value.unshift({ id: order.id as string, time, code, name, trackingNo, company: company.value, ok: true })
    selected.value = null
    say(`已发货 ${code} · ${company.value} ${trackingNo}`)
  } else {
    const msg = mapShipErr(String(r.error || ''))
    // 失败保持选中：多半运单号扫歪/网络抖，纠正后直接重扫，不用再扫箱码
    sessionLog.value.unshift({ id: order.id as string, time, code, name, trackingNo, company: company.value, ok: false, msg })
    say(msg, true)
  }
  focusScan()
}
const shippedCount = computed(() => sessionLog.value.filter((e) => e.ok).length)
const fmtClock = (ts: number) => {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function go(n: number) {
  if (n < 1 || n > 3) return
  step.value = n
  if (n === 2) syncDefaultChecked()
  if (n === 3) focusScan()
}
const railState = (n: number) => (n === step.value ? 'current' : n < step.value ? 'done' : 'todo')
</script>

<template>
  <div class="ld-page">
    <PageHeader title="发货工作台" sub="拣货备货 → 打印内部标签贴箱 → 扫码逐箱发货，一箱一单不打字">
      <Badge v-if="!loading && !loadErr" tone="brand">待发货 {{ summary.orderCount }} 单 · 共 {{ summary.totalQty }} 件</Badge>
      <UiButton variant="ghost" size="sm" :disabled="loading" @click="reload">
        <RefreshCw :size="14" :stroke-width="1.8" /><span>刷新队列</span>
      </UiButton>
    </PageHeader>

    <!-- 三步导航 rail -->
    <div class="rail">
      <template v-for="sn in 3" :key="sn">
        <span v-if="sn > 1" class="rail-line" :class="{ lit: railState(sn) !== 'todo' }"></span>
        <button class="rail-step" :class="railState(sn)" @click="go(sn)">
          <span class="circ">{{ railState(sn) === 'done' ? '✓' : sn }}</span>
          <span class="sname">{{ FULFILL_STEP_NAMES[sn - 1] }}</span>
        </button>
      </template>
    </div>

    <p v-if="loadErr" class="status-err">{{ loadErr }}</p>
    <p v-else-if="loading" class="ld-status">加载待发货队列中…</p>

    <template v-else>
      <!-- 步1 拣货备货 -->
      <template v-if="step === 1">
        <div class="ld-kpi-grid">
          <KpiCard label="待发货订单" :value="summary.orderCount" :icon="Package" />
          <KpiCard label="需备货合计（件）" :value="summary.totalQty" />
          <KpiCard v-if="summary.earliestCreatedAt" label="最早一单" :value="fmtTime(summary.earliestCreatedAt)" />
        </div>
        <p v-if="summary.mismatchCount" class="warn-line">
          其中 {{ summary.mismatchCount }} 单金额异常——货照备；发货前须到「订单发货」页核对流水解除，扫码发货时会被挡下。
        </p>
        <EmptyState v-if="!summary.products.length" :icon="Package" text="没有待发货订单，今天不用备货 🎉" />
        <div v-else class="ld-table">
          <div class="ld-thead">
            <div class="ld-th grow">产品</div>
            <div class="ld-th qty-col" :style="{ width: '140px' }">需备数量</div>
          </div>
          <div class="ld-tbody">
            <div v-for="p in summary.products" :key="p.name" class="ld-tr">
              <div class="ld-td grow">{{ p.name }}</div>
              <div class="ld-td qty-col qty-val" :style="{ width: '140px' }">× {{ p.qty }}</div>
            </div>
          </div>
        </div>
        <p class="tip">备好货后进「打印标签」，一单一张贴箱，照标签清单装货。</p>
      </template>

      <!-- 步2 打印标签 -->
      <template v-else-if="step === 2">
        <div class="ld-toolbar">
          <select v-model="paperKey" class="sel" @change="onPaperChange">
            <option v-for="p in PAPER_PRESETS" :key="p.key" :value="p.key">{{ p.label }}</option>
          </select>
          <UiButton variant="ghost" size="sm" @click="selectUnprinted">只选未打印</UiButton>
          <UiButton variant="ghost" size="sm" @click="selectAll">全选</UiButton>
          <span class="tb-grow"></span>
          <UiButton :disabled="!chosen.length || printing" @click="doPrint">
            <Printer :size="14" :stroke-width="1.8" /><span>{{ printing ? '生成中…' : `打印 ${chosen.length} 张标签` }}</span>
          </UiButton>
        </div>
        <p v-if="printMsg" class="ok-line">{{ printMsg }}</p>
        <p class="tip">打印记录只记在本机浏览器；打废的单点「已打印」徽标取消，重新勾选再打。</p>
        <EmptyState v-if="!orders.length" :icon="Printer" text="没有待发货订单，无标签可打" />
        <div v-else class="p-body">
          <Card class="p-list-card" title="订单清单" :sub="`${orders.length} 单`" flush>
            <div class="p-list">
              <div v-for="o in orders" :key="o.id" class="p-order" :class="{ on: previewId === o.id }" @click="openPreview(o)">
                <input type="checkbox" :checked="checked.has(o.id as string)" @click.stop @change="toggleCheck(o.id as string)" />
                <div class="po-main">
                  <b class="mono">{{ shortCode(o.id) }}</b>
                  <span class="po-name">{{ o.address?.name }}</span>
                  <span class="po-meta">{{ labelData(o).totalQty }} 件 · {{ fmtTime(o.createdAt) }}</span>
                  <span class="flex"></span>
                  <Badge v-if="printed.has(o.id as string)" tone="green" class="badge-tap" title="点击取消已打印标记" @click.stop="togglePrinted(o.id as string)">已打印 ✕</Badge>
                  <Badge v-if="o.feeMismatch" tone="red">金额异常</Badge>
                </div>
              </div>
            </div>
          </Card>
          <Card class="p-preview-card" title="标签预览" sub="所打即所见">
            <template v-if="previewLabel">
              <div class="pv-head">
                <img v-if="previewQr" :src="previewQr" class="pv-qr" alt="qr" />
                <div>
                  <div class="pv-short">{{ previewLabel.shortCode }}</div>
                  <div class="pv-full mono">{{ previewLabel.id }}</div>
                </div>
              </div>
              <div class="pv-who"><b>{{ previewLabel.name }}&nbsp;&nbsp;{{ previewLabel.phone }}</b><div>{{ previewLabel.addressText }}</div></div>
              <div class="pv-goods">
                <div v-for="l in previewLabel.lines" :key="l.name" class="pv-line"><span>{{ l.name }}</span><b>× {{ l.qty }}</b></div>
              </div>
              <div class="pv-total">共 {{ previewLabel.totalQty }} 件</div>
            </template>
            <EmptyState v-else :icon="Printer" text="点左侧订单预览标签样式（所打即所见）" />
          </Card>
        </div>
      </template>

      <!-- 步3 扫码发货 -->
      <template v-else>
        <div class="s-toolbar">
          <label class="lb">物流公司</label>
          <select v-model="company" class="sel" @change="onCompanyChange">
            <option v-for="c in COMPANIES" :key="c" :value="c">{{ c }}</option>
          </select>
          <div class="scanbox" :class="{ off: !focused }">
            <ScanLine :size="16" :stroke-width="1.8" />
            <input
              ref="scanEl"
              v-model="scanText"
              class="scan-input"
              placeholder="扫箱上内部码选单 → 再扫快递面单条码发货"
              @focus="focused = true"
              @blur="focused = false"
              @keyup.enter="onScan"
            />
            <span class="dot" :class="{ ok: focused }"></span>
          </div>
        </div>
        <button v-if="!focused" class="paused" @click="focusScan">⚠ 扫码已暂停（输入框失去焦点）——点这里恢复；输入法请切英文</button>
        <p v-else class="tip">扫码枪对准就绪 · 输入法保持英文；先箱码后面单码，一箱一单。</p>
        <p v-if="scanMsg" class="scan-msg" :class="{ bad: scanMsgBad }">{{ scanMsg }}</p>

        <div class="s-body">
          <Card class="check-card" title="订单核对">
            <template #head>
              <UiButton v-if="selectedLabel" variant="ghost" size="sm" @click="selected = null; focusScan()">取消选中</UiButton>
            </template>
            <template v-if="selectedLabel">
              <div class="ck-head">
                <span class="ck-short">{{ selectedLabel.shortCode }}</span>
                <span class="ck-full mono">{{ selectedLabel.id }}</span>
              </div>
              <p v-if="selected?.feeMismatch" class="warn-line">金额异常单——先到「订单发货」页核对流水解除，才能发货。</p>
              <div class="ck-who"><b>{{ selectedLabel.name }}&nbsp;&nbsp;{{ selectedLabel.phone }}</b><div>{{ selectedLabel.addressText }}</div></div>
              <div class="ck-goods">
                <div v-for="l in selectedLabel.lines" :key="l.name" class="ck-line"><span>{{ l.name }}</span><b>× {{ l.qty }}</b></div>
              </div>
              <div class="ck-total">共 {{ selectedLabel.totalQty }} 件 · 核对无误后扫快递面单条码即发货{{ shipping ? '（发货中…）' : '' }}</div>
            </template>
            <EmptyState v-else :icon="ScanLine" text="扫箱上的内部二维码，订单核对卡显示在这里" />
          </Card>
          <Card class="feed-card" title="发货记录" :sub="`剩 ${orders.length} 单待发 · 本次已发 ${shippedCount} 单`" flush>
            <EmptyState v-if="!sessionLog.length" text="本次还没有发货记录" />
            <div v-else class="feed-list">
              <div v-for="(e, i) in sessionLog" :key="e.id + '-' + e.time + '-' + i" class="feed-row" :class="{ bad: !e.ok }">
                <span class="f-time">{{ fmtClock(e.time) }}</span>
                <b class="mono">{{ e.code }}</b>
                <span class="f-name">{{ e.name }}</span>
                <span class="f-track mono">{{ e.trackingNo }}</span>
                <span class="f-res">{{ e.ok ? '✓ 已发货' : e.msg }}</span>
              </div>
            </div>
          </Card>
        </div>
      </template>

      <!-- 步导航 -->
      <div class="nav">
        <UiButton v-if="step > 1" variant="ghost" @click="go(step - 1)">← 上一步 · {{ FULFILL_STEP_NAMES[step - 2] }}</UiButton>
        <span class="tb-grow"></span>
        <UiButton v-if="step < 3" @click="go(step + 1)"><Package :size="14" :stroke-width="1.8" /><span>下一步 · {{ FULFILL_STEP_NAMES[step] }} →</span></UiButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 本页独有：三步 rail / 打印清单·标签预览 / 扫码框·核对卡·发货记录流。
 * 页头/KPI/卡/徽章/空态/按钮/表格/工具条已交共享原语与 .ld-* 全局类。 */

/* 通用小件 */
.status-err {
  font-size: 13px;
  color: var(--ld-red);
}
.tip {
  margin: 0;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.warn-line {
  margin: 0;
  padding: 9px 13px;
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  font-size: 11.5px;
}
.ok-line {
  margin: 0;
  font-size: 12.5px;
  color: var(--ld-green);
}
.flex {
  flex: 1;
}
.tb-grow {
  flex: 1;
}
.mono {
  font-family: var(--ld-font-mono);
}

/* 三步导航 rail（步骤指示器·本页独有） */
.rail {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
}
.rail-line {
  flex: 1;
  height: 2px;
  border-radius: 2px;
  background: var(--ld-line);
}
.rail-line.lit {
  background: var(--ld-green);
}
.rail-step {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.circ {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 700;
  background: var(--ld-bg-grey);
  border: 1px solid var(--ld-line-strong);
  color: var(--ld-content-2);
}
.sname {
  font-size: 12px;
  color: var(--ld-content-2);
}
.rail-step.done .circ {
  background: var(--ld-bg-green-soft);
  border-color: var(--ld-green);
  color: var(--ld-green);
}
.rail-step.done .sname {
  color: var(--ld-content);
}
.rail-step.current .circ {
  background: var(--ld-purple-ink);
  border-color: var(--ld-purple-ink);
  color: #fff;
}
.rail-step.current .sname {
  color: var(--ld-purple-ink);
  font-weight: 700;
}

/* 步1 备货表：右列数量对齐 */
.qty-col {
  justify-content: flex-end;
}
.qty-val {
  font-weight: 700;
  color: var(--ld-purple-ink);
}

/* 步2/步3 双列布局 */
.sel {
  padding: 8px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12.5px;
  background: var(--ld-bg);
  color: var(--ld-ink);
}
.p-body,
.s-body {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.p-list-card,
.check-card {
  flex: 1;
  min-width: 320px;
}
.p-preview-card,
.feed-card {
  width: 320px;
  flex: 1 0 auto;
  max-width: 100%;
}

/* 步2 打印清单 */
.p-order {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  cursor: pointer;
  border-top: 1px solid var(--ld-line);
}
.p-order.on {
  background: var(--ld-bg-lilac);
}
.p-order input {
  accent-color: var(--ld-brand);
}
.badge-tap {
  cursor: pointer;
}
.po-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.po-name {
  color: var(--ld-content);
}
.po-meta {
  font-size: 11.5px;
  color: var(--ld-content-2);
  white-space: nowrap;
}
/* 步2 标签预览 */
.pv-head {
  display: flex;
  gap: 12px;
  align-items: center;
}
.pv-qr {
  width: 86px;
  height: 86px;
}
.pv-short {
  font-size: 21px;
  font-weight: 800;
  color: var(--ld-ink);
}
.pv-full {
  font-size: 10.5px;
  color: var(--ld-content-2);
  word-break: break-all;
}
.pv-who {
  margin-top: 10px;
  border-top: 1px solid var(--ld-line-strong);
  padding-top: 8px;
  font-size: 12.5px;
  line-height: 1.5;
}
.pv-goods {
  margin-top: 8px;
  border-top: 1px dashed var(--ld-line-strong);
  padding-top: 6px;
}
.pv-line,
.ck-line {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  padding: 2px 0;
}
.pv-total {
  margin-top: 8px;
  border-top: 1px solid var(--ld-line-strong);
  padding-top: 7px;
  text-align: right;
  font-weight: 800;
  font-size: 13px;
  color: var(--ld-ink);
}

/* 步3 扫码框 */
.lb {
  font-size: 12px;
  color: var(--ld-content-2);
  white-space: nowrap;
}
.scanbox {
  flex: 1;
  min-width: 260px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 2px solid var(--ld-brand);
  border-radius: var(--ld-radius-sm);
  padding: 8px 13px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
}
.scanbox.off {
  border-color: var(--ld-line-strong);
}
.scan-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13.5px;
  font-family: var(--ld-font-mono);
  background: transparent;
  color: var(--ld-ink);
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ld-line-strong);
}
.dot.ok {
  background: var(--ld-green);
}
.paused {
  display: block;
  width: 100%;
  border: 1px solid var(--ld-red-line);
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  border-radius: var(--ld-radius-sm);
  padding: 10px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.scan-msg {
  margin: 0;
  font-size: 12.5px;
  color: var(--ld-green);
}
.scan-msg.bad {
  color: var(--ld-red);
}
/* 步3 订单核对卡 */
.ck-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ck-short {
  font-size: 24px;
  font-weight: 800;
  color: var(--ld-purple-ink);
}
.ck-full {
  font-size: 11px;
  color: var(--ld-content-2);
}
.ck-who {
  margin-top: 10px;
  border-top: 1px solid var(--ld-line);
  padding-top: 9px;
  font-size: 13px;
  line-height: 1.55;
}
.ck-goods {
  margin-top: 8px;
  border-top: 1px dashed var(--ld-line-strong);
  padding-top: 6px;
}
.ck-total {
  margin-top: 10px;
  border-top: 1px solid var(--ld-line);
  padding-top: 9px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ld-ink);
}
/* 步3 发货记录流 */
.feed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 11.5px;
  border-top: 1px solid var(--ld-line);
  flex-wrap: wrap;
}
.feed-row:first-child {
  border-top: none;
}
.feed-row.bad {
  background: var(--ld-bg-red-soft);
}
.f-time,
.f-track {
  color: var(--ld-content-2);
}
.f-name {
  color: var(--ld-content);
}
.f-res {
  flex: 1;
  text-align: right;
  color: var(--ld-green);
}
.feed-row.bad .f-res {
  color: var(--ld-red);
}
/* 步导航 */
.nav {
  display: flex;
  align-items: center;
  border-top: 1px solid var(--ld-line);
  padding-top: 16px;
}
</style>
