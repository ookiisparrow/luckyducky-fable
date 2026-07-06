<script setup lang="ts">
// 备货计算 + 产销统计（设计语言一致性·M3 UI 批18·只读）：目标套数 → 外协缺口（带结不外购）+ 采购缺口按供应商分列；
// 产销 = 打包累计 vs 发货累计。逻辑未动，仅套设计语言。
import { ref, onMounted, computed } from 'vue'
import { Plus, ArrowRight, Boxes } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { getRestockPlan, getFgSummary } from '../api/scm'
import { listInventory } from '../api/system'
import { listDrafts } from '../api/products'
import { materialHuman, scmErrorText, productNameOf } from '../lib/mapScm'
import { setPurchaseHandoff, setOutworkHandoff } from '../lib/scmHandoff'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

const router = useRouter()
// 去开单联动（换皮丢·算完缺口只能手抄颜色/料号/数量去另一页开单·流程割裂）：带数据跳转·目标页 consume 预填
function goOutworkOrder() {
  setOutworkHandoff({ lines: (plan.value?.outworkGaps || []).map((g: Record<string, any>) => ({ materialId: `yarn:${g.color}:L:raw`, qty: Number(g.rawToIssue) || 0 })).filter((l) => l.qty > 0) })
  void router.push('/scm-outwork')
}
function goPurchaseOrder(g: Record<string, any>) {
  setPurchaseHandoff({ supplierId: String(g.supplierId || ''), lines: (g.lines || []).map((l: Record<string, any>) => ({ materialId: String(l.materialId), qty: Number(l.gap) || 0 })).filter((l) => l.qty > 0) })
  void router.push('/scm-purchase')
}

const targets = ref<Array<{ productId: string; sets: number }>>([{ productId: '', sets: 10 }])
const plan = ref<Record<string, any> | null>(null)
const fg = ref<{ packed: Array<Record<string, any>>; shipped: Array<Record<string, any>> } | null>(null)
const inv = ref<Record<string, number>>({}) // 成品现存库存 fg:<pid>__<spec> → stock（换皮丢了「现存库存」列）
const products = ref<Array<Record<string, any>>>([]) // 全产品目录（换皮 SCM 未接·产品只显 id·手敲易错）
const productName = (id: unknown) => productNameOf(products.value, id)
const allProductIds = computed(() => products.value.map((p) => String(p.id || p._id)).filter(Boolean))
const message = ref('')

// 产销三列并表（换皮只两列打包/发货·丢了现存库存）：按 产品×规格 union 打包/发货/现存
const produceRows = computed(() => {
  const packed: Record<string, number> = {}
  const shipped: Record<string, number> = {}
  const label: Record<string, string> = {}
  const add = (arr: Record<string, any>[] | undefined, tgt: Record<string, number>) => {
    ;(arr || []).forEach((p) => {
      const key = String(p.productId || '') + '__' + String(p.spec || '')
      tgt[key] = (tgt[key] || 0) + (Number(p.qty) || 0)
      label[key] = productName(p.productId) + (p.spec ? '（' + p.spec + '）' : '')
    })
  }
  add(fg.value?.packed, packed)
  add(fg.value?.shipped, shipped)
  Object.keys(inv.value).forEach((k) => {
    if (!label[k]) {
      const [pid, spec] = k.split('__')
      label[k] = productName(pid) + (spec ? '（' + spec + '）' : '')
    }
  })
  const keys = new Set([...Object.keys(packed), ...Object.keys(shipped), ...Object.keys(inv.value)])
  return [...keys].map((k) => ({ key: k, name: label[k] || k, packed: packed[k] || 0, shipped: shipped[k] || 0, stock: inv.value[k] ?? null })).sort((a, b) => a.name.localeCompare(b.name))
})

async function calc() {
  const ts = targets.value.filter((t) => t.productId.trim())
  if (!ts.length) {
    message.value = '先填至少一个产品'
    return
  }
  const r = await getRestockPlan(ts.map((t) => ({ productId: t.productId.trim(), sets: Number(t.sets) })))
  plan.value = r.ok ? (r as Record<string, any>) : null
  message.value = r.ok ? '' : scmErrorText(r.error)
}

onMounted(async () => {
  const [r, i, d] = await Promise.all([getFgSummary(), listInventory(), listDrafts()])
  products.value = d.ok ? ((d as any).list as Record<string, any>[]) : []
  fg.value = r.ok ? { packed: (r.packed as Record<string, any>[]) || [], shipped: (r.shipped as Record<string, any>[]) || [] } : null
  if (i.ok) {
    const list = ((i as any).list as Record<string, any>[]) || []
    const map: Record<string, number> = {}
    list.forEach((row) => {
      const id = String(row._id || '')
      if (id.startsWith('fg:')) map[id.slice(3)] = Number(row.stock) || 0 // fg:<pid>__<spec> → 现存
    })
    inv.value = map
  }
})
</script>

<template>
  <div class="ld-page">
    <PageHeader
      title="备货计算 & 产销"
      sub="目标套数 → 外协缺口（带结不外购）+ 采购缺口按供应商分列；产销 = 打包累计 vs 发货累计。只读、不动账。"
    />

    <ScmFlowTabs />
    <p v-if="message" class="ld-status err">{{ message }}</p>

    <Card title="备货计算器" sub="只读 · 不动账">
      <div v-for="(t, i) in targets" :key="i" class="linerow">
        <input v-model="t.productId" list="planner-pids" placeholder="产品（选或输 id）" />
        <input v-model.number="t.sets" type="number" min="1" placeholder="目标套数" />
        <button class="icon-x" title="删除这行" @click="targets.splice(i, 1)">×</button>
      </div>
      <datalist id="planner-pids"><option v-for="pid in allProductIds" :key="pid" :value="pid">{{ productName(pid) }}</option></datalist>
      <div class="ops">
        <UiButton variant="ghost" size="sm" @click="targets.push({ productId: '', sets: 10 })"><Plus :size="13" :stroke-width="2" /><span>加产品</span></UiButton>
        <UiButton size="sm" @click="calc">算缺口</UiButton>
      </div>

      <template v-if="plan">
        <div class="gap-block">
          <h3>外协缺口（带结不外购——缺多少带结＝该给织女发多少同色大团原团）</h3>
          <p v-if="!(plan.outworkGaps || []).length" class="ok-line">带结库存够，不用发外协 ✓</p>
          <div v-for="g in plan.outworkGaps" :key="g.color" class="gap-line">
            <span class="gap-name">{{ g.color }}</span>
            <span>带结需 {{ g.knottedNeed }} · 存 {{ g.knottedStock }} · <strong class="short">缺 {{ g.gap }}（应发原团 {{ g.rawToIssue }}）</strong></span>
          </div>
          <UiButton v-if="(plan.outworkGaps || []).length" size="sm" class="gap-cta" @click="goOutworkOrder">照这个去外协开单发料<ArrowRight :size="13" :stroke-width="2" /></UiButton>
        </div>
        <div class="gap-block">
          <h3>采购缺口（按供应商）</h3>
          <p v-if="!(plan.purchaseGroups || []).length" class="ok-line">原料都够，不用采购 ✓</p>
          <div v-for="g in plan.purchaseGroups" :key="g.supplierId" class="sup-group">
            <div class="sup-name-row">
              <span class="sup-name">{{ g.supplierName }}</span>
              <UiButton v-if="g.supplierId" variant="ghost" size="sm" @click="goPurchaseOrder(g)">去这家开采购单<ArrowRight :size="12" :stroke-width="2" /></UiButton>
            </div>
            <div v-for="l in g.lines" :key="l.materialId" class="gap-line">
              <span class="gap-name">{{ materialHuman(l.materialId) }}{{ l.missing ? '（未建档·按需全采）' : '' }}</span>
              <span>需 {{ l.need }} · 存 {{ l.stock }} · <strong class="short">缺 {{ l.gap }}</strong></span>
            </div>
          </div>
          <p v-if="(plan.missingMaterials || []).length" class="warn-note">未建档料：{{ plan.missingMaterials.join('、') }}——先去物料页建档</p>
        </div>
      </template>
    </Card>

    <Card v-if="fg" title="产销统计" sub="打包 · 发货 · 现存库存">
      <div v-if="produceRows.length" class="ld-table">
        <div class="ld-thead">
          <div class="ld-th grow">产品 / 规格</div>
          <div class="ld-th num" :style="{ width: '110px' }">打包累计</div>
          <div class="ld-th num" :style="{ width: '110px' }">发货核销</div>
          <div class="ld-th num" :style="{ width: '110px' }">现存库存</div>
        </div>
        <div class="ld-tbody">
          <div v-for="r in produceRows" :key="r.key" class="ld-tr">
            <div class="ld-td grow pt-name">{{ r.name }}</div>
            <div class="ld-td num" :style="{ width: '110px' }">{{ r.packed }} 套</div>
            <div class="ld-td num" :style="{ width: '110px' }">{{ r.shipped }} 件</div>
            <div class="ld-td num strong" :style="{ width: '110px' }">{{ r.stock == null ? '—' : r.stock }}</div>
          </div>
        </div>
      </div>
      <EmptyState v-else :icon="Boxes" text="还没有产销记录" />
    </Card>
  </div>
</template>

<style scoped>
/* 状态提示（本页 message 仅报错·红） */
.err {
  color: var(--ld-red);
}

/* 备货计算器：目标产品 × 套数行（本页独有多列表单） */
.linerow {
  display: grid;
  grid-template-columns: 2fr 120px auto;
  gap: 8px;
  margin-bottom: 7px;
  align-items: center;
}
.linerow input {
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  background: var(--ld-bg);
}
.icon-x {
  width: 30px;
  height: 34px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 15px;
  cursor: pointer;
}
.icon-x:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.ops {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

/* 缺口块（本页独有：外协缺口 / 采购缺口按供应商分列） */
.gap-block {
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid var(--ld-line);
}
.gap-block h3 {
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-purple-meta);
}
.ok-line {
  margin: 4px 0;
  font-size: 13px;
  color: var(--ld-green);
}
.gap-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
  font-size: 12.5px;
  color: var(--ld-content);
}
.gap-name {
  color: var(--ld-ink);
  font-weight: 600;
}
.short {
  color: var(--ld-red);
}
.gap-cta {
  margin-top: 8px;
}
.sup-group {
  margin-bottom: 10px;
}
.sup-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0 2px;
}
.sup-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ld-brand-active);
}
.warn-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--ld-amber);
}

/* 产销统计表：右对齐定宽数值列（ld-table 首列 grow） */
.num {
  justify-content: flex-end;
  text-align: right;
}
.pt-name {
  color: var(--ld-ink);
  font-weight: 500;
}
.strong {
  font-weight: 700;
  color: var(--ld-ink);
}
</style>
