<script setup>
/**
 * 步3 扫码发货：快递员逐箱贴完面单后——扫箱上内部 QR 选中订单（核对卡与纸标签同一 labelData
 * 口径逐字一致）→ 扫快递面单条码 → 运单号自动进入 → shipOrder 发货，一箱一单不打字。
 * 扫码枪 = 键盘模拟 + 回车后缀：一个输入框收两种码，classifyScan 分拣（安全判序见 utils/fulfill.js）。
 */
import { ref, computed, onMounted, nextTick } from 'vue'
import { shipOrder } from '@/api/cloud.js'
import { toast } from '@/utils/ui.js'
import { classifyScan, labelData, COMPANIES, shortCode } from '@/utils/fulfill.js'
import { ScanLine } from 'lucide-vue-next'

const props = defineProps({
  orders: { type: Array, default: () => [] },
  sessionLog: { type: Array, default: () => [] },
})
const emit = defineEmits(['shipped', 'log'])

const idSet = computed(() => new Set(props.orders.map((o) => o.id)))

// 物流公司粘性选择（记本机·回灌校验 ∈ COMPANIES 防脏数据）
const COMPANY_KEY = 'ld-admin-fulfill-company'
const saved = localStorage.getItem(COMPANY_KEY)
const company = ref(COMPANIES.includes(saved) ? saved : COMPANIES[0])
function onCompanyChange() {
  localStorage.setItem(COMPANY_KEY, company.value)
  focusScan()
}

// —— 扫码输入框焦点管理：失焦即「暂停」，横幅一点恢复 ——
const scanEl = ref(null)
const scanText = ref('')
const focused = ref(false)
function focusScan() {
  nextTick(() => scanEl.value && scanEl.value.focus())
}
onMounted(focusScan)

const selected = ref(null)
const selectedLabel = computed(() => (selected.value ? labelData(selected.value) : null))
const shipping = ref(false)

function onScan() {
  const res = classifyScan(scanText.value, idSet.value)
  scanText.value = ''
  if (res.type === 'empty') return
  if (res.type === 'order') {
    selected.value = props.orders.find((o) => o.id === res.id) || null
    return
  }
  if (res.type === 'order-not-in-queue') {
    const inLog = props.sessionLog.find((e) => e.id === res.id && e.ok)
    toast(
      inLog
        ? `这单刚已发货（${shortCode(res.id)}），别重复装箱`
        : `这张码不在待发货队列（可能已发货或未支付）：${shortCode(res.id)}，可去「订单发货」页搜单号核实`,
      'err',
      4200,
    )
    return
  }
  // tracking
  if (!selected.value) {
    toast('先扫箱上的内部二维码选中订单，再扫快递面单条码', 'err')
    return
  }
  if (selected.value.feeMismatch) {
    toast('金额异常单：先到「订单发货」页核对流水解除，再回来扫码发', 'err', 4200)
    return
  }
  doShip(selected.value, res.trackingNo)
}

function mapShipErr(msg) {
  if (msg === 'FEE_MISMATCH_HOLD') return '金额异常单被挡下：先到「订单发货」页核对流水解除'
  if (msg === 'BAD_STATUS:shipped') return '这单已发过货；要改运单号请去「订单发货」页'
  if (msg && msg.startsWith('BAD_STATUS:')) return `这单当前状态（${msg.slice(11)}）不能发货`
  if (msg === 'NO_ORDER') return '找不到这单订单'
  return `发货失败：${msg}`
}

async function doShip(order, trackingNo) {
  if (shipping.value) return
  shipping.value = true
  const time = Date.now()
  const code = shortCode(order.id)
  const name = order.address?.name || '—'
  try {
    await shipOrder(order.id, company.value, trackingNo)
    emit('shipped', {
      id: order.id,
      entry: { id: order.id, time, shortCode: code, name, trackingNo, company: company.value, ok: true },
    })
    selected.value = null
    toast(`已发货 ${code} · ${company.value} ${trackingNo}`, 'ok')
  } catch (e) {
    const msg = mapShipErr(e.message)
    // 失败保持选中：多半是运单号扫歪/网络抖，纠正后直接重扫，不用再扫一遍箱码
    emit('log', { id: order.id, time, shortCode: code, name, trackingNo, company: company.value, ok: false, msg })
    toast(msg, 'err', 4200)
  } finally {
    shipping.value = false
    focusScan()
  }
}

const shippedCount = computed(() => props.sessionLog.filter((e) => e.ok).length)

function fmtClock(ts) {
  const d = new Date(ts)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
</script>

<template>
  <div>
    <div class="toolbar">
      <label class="lb">物流公司</label>
      <select v-model="company" class="input mini" @change="onCompanyChange">
        <option v-for="c in COMPANIES" :key="c" :value="c">{{ c }}</option>
      </select>
      <div class="scanbox" :class="{ off: !focused }">
        <ScanLine :size="16" />
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

    <div class="body">
      <div class="check card" :class="{ empty: !selectedLabel }">
        <template v-if="selectedLabel">
          <div class="ck-head">
            <span class="ck-short">{{ selectedLabel.shortCode }}</span>
            <span class="ck-full mono">{{ selectedLabel.id }}</span>
            <span class="flex"></span>
            <button class="btn ghost mini" @click="selected = null; focusScan()">取消选中</button>
          </div>
          <p v-if="selected.feeMismatch" class="hint warn">金额异常单——先到「订单发货」页核对流水解除，才能发货。</p>
          <div class="ck-who">
            <b>{{ selectedLabel.name }}&nbsp;&nbsp;{{ selectedLabel.phone }}</b>
            <div>{{ selectedLabel.addressText }}</div>
          </div>
          <div class="ck-goods">
            <div v-for="l in selectedLabel.lines" :key="l.name" class="ck-line">
              <span>{{ l.name }}</span><b>× {{ l.qty }}</b>
            </div>
          </div>
          <div class="ck-total">共 {{ selectedLabel.totalQty }} 件 · 核对无误后扫快递面单条码即发货{{ shipping ? '（发货中…）' : '' }}</div>
        </template>
        <p v-else class="ck-empty">扫箱上的内部二维码，订单核对卡显示在这里</p>
      </div>

      <div class="feed">
        <div class="feed-head">待发货剩 <b>{{ orders.length }}</b> 单 · 本次已发 <b>{{ shippedCount }}</b> 单</div>
        <p v-if="!sessionLog.length" class="feed-empty">本次还没有发货记录</p>
        <div v-for="(e, i) in sessionLog" :key="e.id + '-' + e.time + '-' + i" class="feed-row" :class="{ bad: !e.ok }">
          <span class="f-time">{{ fmtClock(e.time) }}</span>
          <b class="mono">{{ e.shortCode }}</b>
          <span class="f-name">{{ e.name }}</span>
          <span class="f-track mono">{{ e.trackingNo }}</span>
          <span class="f-res">{{ e.ok ? '✓ 已发货' : e.msg }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.lb {
  font-size: 12px;
  color: var(--content-2);
  white-space: nowrap;
}
.input.mini {
  width: auto;
  padding: 8px 10px;
  font-size: 12.5px;
}
.scanbox {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 2px solid var(--brand);
  border-radius: 10px;
  padding: 8px 13px;
  background: var(--white);
}
.scanbox.off {
  border-color: var(--line-strong);
}
.scan-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13.5px;
  font-family: ui-monospace, Menlo, monospace;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--line-strong);
}
.dot.ok {
  background: var(--green);
}
.paused {
  display: block;
  width: 100%;
  border: 1px solid #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
  border-radius: 10px;
  padding: 10px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 14px;
}
.tip {
  margin: 0 2px 14px;
  font-size: 11.5px;
  color: var(--content-2);
}
.body {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  flex-wrap: wrap; /* 窄窗口流水面板换行，别把核对卡挤成一列竖字 */
}
.check {
  flex: 1;
  min-width: 320px;
  padding: 16px 18px;
  border-radius: 11px;
}
.check.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
}
.ck-empty {
  font-size: 12.5px;
  color: var(--content-2);
}
.ck-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ck-short {
  font-size: 24px;
  font-weight: 800;
  color: var(--purple-ink);
}
.ck-full {
  font-size: 11px;
  color: var(--content-2);
}
.flex {
  flex: 1;
}
.btn.mini {
  padding: 6px 12px;
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, Menlo, monospace;
}
.ck-who {
  margin-top: 10px;
  border-top: 1px solid var(--line);
  padding-top: 9px;
  font-size: 13px;
  line-height: 1.55;
}
.ck-goods {
  margin-top: 8px;
  border-top: 1px dashed var(--line-strong);
  padding-top: 6px;
}
.ck-line {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 2.5px 0;
}
.ck-total {
  margin-top: 10px;
  border-top: 1px solid var(--line);
  padding-top: 9px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
}
.feed {
  width: 340px;
  flex: 1 0 auto;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 11px;
  overflow: hidden;
}
.feed-head {
  padding: 10px 14px;
  background: var(--bg-lilac);
  font-size: 12px;
  color: var(--content-2);
}
.feed-head b {
  color: var(--purple-ink);
  font-size: 14px;
}
.feed-empty {
  margin: 0;
  padding: 16px 14px;
  font-size: 12px;
  color: var(--content-2);
}
.feed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 11.5px;
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}
.feed-row.bad {
  background: #fdf0ef;
}
.f-time {
  color: var(--content-2);
}
.f-name {
  color: var(--content);
}
.f-track {
  color: var(--content-2);
}
.f-res {
  flex: 1;
  text-align: right;
  color: var(--green);
}
.feed-row.bad .f-res {
  color: var(--red);
}
.hint.warn {
  padding: 9px 13px;
  border-radius: 10px;
  border: 1px solid #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
  font-size: 11.5px;
  margin: 10px 0 0;
}
</style>
