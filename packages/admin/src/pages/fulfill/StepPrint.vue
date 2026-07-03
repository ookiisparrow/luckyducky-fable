<script setup>
/**
 * 步2 打印内部标签：勾选订单 → 新窗口写入标签 HTML → 浏览器打印（一单一页，QR=订单id）。
 * 「已打印」记 localStorage（单机小店够用，不建后端字段）：队列是「全部待发货」累积制，
 * 第二天必然有昨天已贴标签的单，不记就是确定性重复打；打废可点徽标取消重打。
 * 标记时机 = 点打印即标（浏览器测不出真出纸，出纸失败走手动取消）。
 */
import { ref, computed, watch } from 'vue'
import QRCode from 'qrcode'
import { toast } from '@/utils/ui.js'
import { labelData, buildLabelHtml, PAPER_PRESETS } from '@/utils/fulfill.js'
import { Printer } from 'lucide-vue-next'

const props = defineProps({ orders: { type: Array, default: () => [] } })

// —— 已打印记忆（localStorage·回灌 sanitize）——
const PRINTED_KEY = 'ld-admin-fulfill-printed'
function loadPrinted() {
  try {
    const v = JSON.parse(localStorage.getItem(PRINTED_KEY) || '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
const printed = ref(loadPrinted())
function savePrinted() {
  // 与当前队列求交集 GC：发货出队的单不再占存储，集合不无限增长
  const alive = new Set(props.orders.map((o) => o.id))
  localStorage.setItem(PRINTED_KEY, JSON.stringify([...printed.value].filter((id) => alive.has(id))))
}
function togglePrinted(id) {
  const s = new Set(printed.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  printed.value = s
  savePrinted()
}

// —— 纸张预设（记本机）——
const PAPER_KEY = 'ld-admin-fulfill-paper'
const paperKey = ref(localStorage.getItem(PAPER_KEY) || PAPER_PRESETS[0].key)
if (!PAPER_PRESETS.some((p) => p.key === paperKey.value)) paperKey.value = PAPER_PRESETS[0].key
watch(paperKey, (v) => localStorage.setItem(PAPER_KEY, v))
const preset = computed(() => PAPER_PRESETS.find((p) => p.key === paperKey.value) || PAPER_PRESETS[0])

// —— 勾选（默认勾全部未打印）——
const checked = ref(new Set(props.orders.filter((o) => !printed.value.has(o.id)).map((o) => o.id)))
function toggleCheck(id) {
  const s = new Set(checked.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  checked.value = s
}
function selectAll() {
  checked.value = new Set(props.orders.map((o) => o.id))
}
function selectUnprinted() {
  checked.value = new Set(props.orders.filter((o) => !printed.value.has(o.id)).map((o) => o.id))
}
const chosen = computed(() => props.orders.filter((o) => checked.value.has(o.id)))

// —— 预览（点卡片看单张标签近似样，含真 QR）——
const previewId = ref('')
const previewQr = ref('')
const previewLabel = computed(() => {
  const o = props.orders.find((x) => x.id === previewId.value)
  return o ? labelData(o) : null
})
async function openPreview(o) {
  previewId.value = o.id
  previewQr.value = await QRCode.toDataURL(o.id, { width: 300, margin: 1 })
}

// —— 打印 ——
const printing = ref(false)
async function doPrint() {
  if (printing.value || !chosen.value.length) return
  printing.value = true
  try {
    const labels = await Promise.all(
      chosen.value.map(async (o) => ({
        ...labelData(o),
        qrDataUrl: await QRCode.toDataURL(o.id, { width: 300, margin: 1 }),
      })),
    )
    const w = window.open('', '_blank')
    if (!w) {
      toast('浏览器拦截了打印窗口，请允许本站弹窗后重试', 'err')
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
    toast(`已生成 ${labels.length} 张标签，打印后贴箱、照标签清单装货`, 'ok')
  } finally {
    printing.value = false
  }
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const totalOf = (o) => labelData(o).totalQty
const codeOf = (o) => labelData(o).shortCode
</script>

<template>
  <div>
    <div class="toolbar">
      <select v-model="paperKey" class="input mini">
        <option v-for="p in PAPER_PRESETS" :key="p.key" :value="p.key">{{ p.label }}</option>
      </select>
      <button class="btn ghost mini" @click="selectUnprinted">只选未打印</button>
      <button class="btn ghost mini" @click="selectAll">全选</button>
      <span class="flex"></span>
      <button class="btn primary" :disabled="!chosen.length || printing" @click="doPrint">
        <Printer :size="15" />{{ printing ? '生成中…' : `打印 ${chosen.length} 张标签` }}
      </button>
    </div>
    <p class="tip">打印记录只记在本机浏览器；打废的单点「已打印」徽标取消，重新勾选再打。</p>

    <p v-if="!orders.length" class="hint">没有待发货订单，无标签可打。</p>
    <div v-else class="body">
      <div class="list">
        <div
          v-for="o in orders"
          :key="o.id"
          class="order"
          :class="{ on: previewId === o.id }"
          @click="openPreview(o)"
        >
          <input type="checkbox" :checked="checked.has(o.id)" @click.stop @change="toggleCheck(o.id)" />
          <div class="o-main">
            <div class="o-top">
              <b class="mono">{{ codeOf(o) }}</b>
              <span class="o-name">{{ o.address?.name }}</span>
              <span class="o-meta">{{ totalOf(o) }} 件 · {{ fmtTime(o.createdAt) }}</span>
            </div>
            <div class="o-badges">
              <span v-if="printed.has(o.id)" class="chip green mini-chip" @click.stop="togglePrinted(o.id)" title="点击取消已打印标记">已打印 ✕</span>
              <span v-if="o.feeMismatch" class="chip warn-chip">金额异常</span>
            </div>
          </div>
        </div>
      </div>

      <div class="preview card">
        <template v-if="previewLabel">
          <div class="pv-head">
            <img v-if="previewQr" :src="previewQr" class="pv-qr" alt="qr" />
            <div>
              <div class="pv-short">{{ previewLabel.shortCode }}</div>
              <div class="pv-full mono">{{ previewLabel.id }}</div>
            </div>
          </div>
          <div class="pv-who">
            <b>{{ previewLabel.name }}&nbsp;&nbsp;{{ previewLabel.phone }}</b>
            <div>{{ previewLabel.addressText }}</div>
          </div>
          <div class="pv-goods">
            <div v-for="l in previewLabel.lines" :key="l.name" class="pv-line">
              <span>{{ l.name }}</span><b>× {{ l.qty }}</b>
            </div>
          </div>
          <div class="pv-total">共 {{ previewLabel.totalQty }} 件</div>
        </template>
        <p v-else class="pv-empty">点左侧订单预览标签样式（所打即所见）</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.input.mini {
  width: auto;
  padding: 7px 10px;
  font-size: 12.5px;
}
.btn.mini {
  padding: 7px 13px;
  font-size: 12px;
}
.flex {
  flex: 1;
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
  flex-wrap: wrap; /* 窄窗口预览面板换行，列表不被挤扁 */
}
.list {
  flex: 1;
  min-width: 320px;
  border: 1px solid var(--line);
  border-radius: 11px;
  overflow: hidden;
}
.order {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  cursor: pointer;
}
.order + .order {
  border-top: 1px solid var(--line);
}
.order.on {
  background: var(--bg-lilac);
}
.o-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}
.o-top {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  font-size: 13px;
}
.mono {
  font-family: ui-monospace, Menlo, monospace;
}
.o-name {
  color: var(--content);
}
.o-meta {
  font-size: 11.5px;
  color: var(--content-2);
  white-space: nowrap;
}
.o-badges {
  display: flex;
  gap: 6px;
}
.mini-chip {
  cursor: pointer;
}
.chip.warn-chip {
  background: #fdf0ef;
  border-color: #f0c8c5;
  color: var(--red);
}
.preview {
  width: 300px;
  flex: 0 0 auto;
  padding: 16px;
  border-radius: 11px;
}
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
  color: var(--ink);
}
.pv-full {
  font-size: 10.5px;
  color: var(--content-2);
  word-break: break-all;
}
.pv-who {
  margin-top: 10px;
  border-top: 1px solid var(--line-strong);
  padding-top: 8px;
  font-size: 12.5px;
  line-height: 1.5;
}
.pv-goods {
  margin-top: 8px;
  border-top: 1px dashed var(--line-strong);
  padding-top: 6px;
}
.pv-line {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  padding: 2px 0;
}
.pv-total {
  margin-top: 8px;
  border-top: 1px solid var(--line-strong);
  padding-top: 7px;
  text-align: right;
  font-weight: 800;
  font-size: 13px;
  color: var(--ink);
}
.pv-empty {
  margin: 30px 0;
  text-align: center;
  font-size: 12px;
  color: var(--content-2);
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
</style>
