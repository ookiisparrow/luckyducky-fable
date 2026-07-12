<script setup lang="ts">
// 供应链总览（批 B2：无聚合看板，低库存/应付/在途要跑 5 页各看各的）——进销存着陆页
// 「今天该干啥」一屏看：KPI×4 + 缺料预警表（去采购/去外协直达）+ 应付未结（按织女）+ 最近流水。
// 只读，不动账；卡片直达对应 SCM 页（继续该页原有流程）。
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Boxes, Wallet, Truck, Handshake, RefreshCw, ArrowRight, ClipboardCheck } from 'lucide-vue-next'
import { getScmOverview } from '../api/scm'
import { materialHuman, fenLabel } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import { setPurchaseHandoff, setOutworkHandoff } from '../lib/scmHandoff'
import { useLoadStatus } from '../lib/status'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

const router = useRouter()
const { message, ok: msgOk, load } = useLoadStatus()
const busy = ref(false)
const vm = ref<Record<string, any> | null>(null)

async function reload() {
  busy.value = true
  const r = await getScmOverview()
  busy.value = false
  load(!!r.ok, '总览加载失败：' + String((r as any).error || ''))
  vm.value = r.ok ? (r as Record<string, any>) : null
}
onMounted(reload)

const lowStock = computed(() => (vm.value?.lowStock as Array<Record<string, any>>) || [])
const payables = computed(() => (vm.value?.payables as Array<Record<string, any>>) || [])
const recentLedger = computed(() => (vm.value?.recentLedger as Array<Record<string, any>>) || [])
const inTransit = computed(() => vm.value?.inTransit || { purchaseCount: 0, outworkCount: 0 })

const KNOTTED_RE = /^yarn:([a-z][a-z0-9-]*):L:knotted$/

// 缺料行去开单（同 ScmPlanner goOutworkOrder/goPurchaseOrder 中转手法）：带结缺口＝应发同色大团原团（1:1）；
// 采购缺口按行预填料号+缺口量，供应商留空（lowStock 不带 supplierId·到采购页手选）。
function fixRow(row: Record<string, any>) {
  if (row.suggest === 'outwork') {
    const m = KNOTTED_RE.exec(String(row.materialId))
    const rawId = m ? `yarn:${m[1]}:L:raw` : String(row.materialId)
    setOutworkHandoff({ lines: [{ materialId: rawId, qty: Number(row.gap) || 0 }] })
    void router.push('/scm-outwork')
  } else {
    setPurchaseHandoff({ supplierId: '', lines: [{ materialId: String(row.materialId), qty: Number(row.gap) || 0 }] })
    void router.push('/scm-purchase')
  }
}

// 最近流水类型徽章：入(购入/收货回料)·出(发料/扣料)·产(组装入成品)·销(发货核销)——docType→四类映射。
const LEDGER_BADGE: Record<string, { label: string; tone: 'green' | 'red' | 'brand' | 'amber' }> = {
  purchase_in: { label: '入', tone: 'green' },
  outwork_receive: { label: '入', tone: 'green' },
  outwork_issue: { label: '出', tone: 'red' },
  assembly_out: { label: '出', tone: 'red' },
  assembly_in: { label: '产', tone: 'brand' },
  ship: { label: '销', tone: 'amber' },
}
function ledgerBadge(l: Record<string, any>) {
  const hit = LEDGER_BADGE[String(l.docType)]
  if (hit) return hit
  // adjust 无固定方向：按流水正负判入/出
  return Number(l.delta) >= 0 ? { label: '入', tone: 'green' as const } : { label: '出', tone: 'red' as const }
}
</script>

<template>
  <div class="ld-page">
    <PageHeader title="供应链总览" sub="今天该干啥一屏看——缺料预警 · 应付未结 · 在途单据 · 最近流水，卡片直达对应页">
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="reload">
        <RefreshCw :size="14" :stroke-width="1.8" :class="{ spin: busy }" />
        <span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status" :class="msgOk ? 'is-ok' : 'is-err'">
      {{ message }}
      <UiButton v-if="!msgOk" variant="ghost" size="sm" @click="reload">重试</UiButton>
    </p>

    <template v-if="vm">
      <div class="ld-kpi-grid">
        <KpiCard label="缺料物料" :value="lowStock.length" :icon="Boxes" :tone="lowStock.length ? 'red' : 'neutral'" />
        <KpiCard label="未结应付" :value="fenLabel(vm.payableTotalFen) || '¥0.00'" :icon="Wallet" :tone="vm.payableTotalFen ? 'amber' : 'neutral'" />
        <KpiCard label="在途采购" :value="inTransit.purchaseCount" :icon="Truck" />
        <KpiCard label="在途外协" :value="inTransit.outworkCount" :icon="Handshake" />
      </div>

      <div class="ld-cols-2">
        <Card title="缺料预警" sub="账面低于安全线的物料，按缺口从大到小">
          <div v-if="lowStock.length" class="ld-table">
            <div class="ld-thead">
              <div class="ld-th grow">物料</div>
              <div class="ld-th num" :style="{ width: '64px' }">计量</div>
              <div class="ld-th num" :style="{ width: '70px' }">账面</div>
              <div class="ld-th num" :style="{ width: '70px' }">安全线</div>
              <div class="ld-th num" :style="{ width: '60px' }">缺口</div>
              <div class="ld-th" :style="{ width: '92px' }">操作</div>
            </div>
            <div class="ld-tbody">
              <div v-for="row in lowStock" :key="row.materialId" class="ld-tr">
                <div class="ld-td grow">{{ row.name }}</div>
                <div class="ld-td num" :style="{ width: '64px' }">{{ row.uomLabel }}</div>
                <div class="ld-td num" :style="{ width: '70px' }">{{ row.qty }}</div>
                <div class="ld-td num" :style="{ width: '70px' }">{{ row.threshold }}</div>
                <div class="ld-td num short" :style="{ width: '60px' }">{{ row.gap }}</div>
                <div class="ld-td" :style="{ width: '92px' }">
                  <UiButton variant="ghost" size="sm" @click="fixRow(row)">
                    {{ row.suggest === 'outwork' ? '去外协' : '去采购' }}<ArrowRight :size="12" :stroke-width="2" />
                  </UiButton>
                </div>
              </div>
            </div>
          </div>
          <EmptyState v-else :icon="ClipboardCheck" text="库存健康 ✓" />
        </Card>

        <div class="side-col">
          <Card title="应付未结" :sub="`按织女 · 合计 ${fenLabel(vm.payableTotalFen) || '¥0.00'}${vm.truncated ? '（超 200 单，数字可能不全）' : ''}`">
            <div v-if="payables.length" class="pay-rows">
              <div v-for="g in payables" :key="g.supplierId" class="pay-row">
                <div class="pay-name">{{ g.name }}<span class="pay-count">{{ g.orderCount }} 单</span></div>
                <div class="pay-right">
                  <span class="pay-fen">{{ fenLabel(g.payableFen) }}</span>
                  <UiButton variant="ghost" size="sm" @click="router.push('/scm-outwork')">去结算</UiButton>
                </div>
              </div>
            </div>
            <EmptyState v-else :icon="Wallet" text="无未结应付" />
          </Card>

          <Card title="最近流水" sub="全库最新 8 条">
            <div v-if="recentLedger.length" class="ledger-rows">
              <div v-for="l in recentLedger" :key="l._id" class="ledger-row">
                <Badge :tone="ledgerBadge(l).tone">{{ ledgerBadge(l).label }}</Badge>
                <div class="ledger-mid">
                  <div class="ledger-mat">{{ materialHuman(l.itemKey) }}</div>
                  <div class="ledger-at">{{ dateTime(l.at) }}</div>
                </div>
                <div class="ledger-delta" :class="{ neg: l.delta < 0 }">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</div>
              </div>
            </div>
            <EmptyState v-else text="还没有流水记录" />
          </Card>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.is-err {
  color: var(--ld-red);
}
.is-ok {
  color: var(--ld-green);
}
.num {
  justify-content: flex-end;
  text-align: right;
}
.short {
  color: var(--ld-red);
  font-weight: 700;
}
.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.side-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.pay-rows {
  display: flex;
  flex-direction: column;
}
.pay-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--ld-line);
  font-size: 13px;
}
.pay-row:last-child {
  border-bottom: none;
}
.pay-name {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--ld-ink);
  font-weight: 600;
}
.pay-count {
  color: var(--ld-content-2);
  font-weight: 400;
  font-size: 11.5px;
}
.pay-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.pay-fen {
  color: var(--ld-amber);
  font-weight: 700;
}

.ledger-rows {
  display: flex;
  flex-direction: column;
}
.ledger-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--ld-line);
}
.ledger-row:last-child {
  border-bottom: none;
}
.ledger-mid {
  flex: 1;
  min-width: 0;
}
.ledger-mat {
  font-size: 12.5px;
  color: var(--ld-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ledger-at {
  font-size: 11px;
  color: var(--ld-content-2);
}
.ledger-delta {
  flex: none;
  font-size: 13px;
  font-weight: 700;
  color: var(--ld-green);
}
.ledger-delta.neg {
  color: var(--ld-red);
}
</style>
