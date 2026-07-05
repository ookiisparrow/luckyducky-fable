<script setup lang="ts">
// 备货计算 + 产销统计（设计语言一致性·M3 UI 批18·只读）：目标套数 → 外协缺口（带结不外购）+ 采购缺口按供应商分列；
// 产销 = 打包累计 vs 发货累计。逻辑未动，仅套设计语言。
import { ref, onMounted } from 'vue'
import { Plus } from 'lucide-vue-next'
import { getRestockPlan, getFgSummary } from '../api/scm'
import { materialHuman, scmErrorText } from '../lib/mapScm'

const targets = ref<Array<{ productId: string; sets: number }>>([{ productId: '', sets: 10 }])
const plan = ref<Record<string, any> | null>(null)
const fg = ref<{ packed: Array<Record<string, any>>; shipped: Array<Record<string, any>> } | null>(null)
const message = ref('')

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
  const r = await getFgSummary()
  fg.value = r.ok ? { packed: (r.packed as Record<string, any>[]) || [], shipped: (r.shipped as Record<string, any>[]) || [] } : null
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>备货计算 & 产销</h1>
      <p class="sub">目标套数 → 外协缺口（带结不外购）+ 采购缺口按供应商分列；产销 = 打包累计 vs 发货累计。只读、不动账。</p>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <section class="card">
      <h2>备货计算器（只读·不动账）</h2>
      <div v-for="(t, i) in targets" :key="i" class="linerow">
        <input v-model="t.productId" placeholder="产品 id" />
        <input v-model.number="t.sets" type="number" min="1" placeholder="目标套数" />
        <button class="icon-x" @click="targets.splice(i, 1)">×</button>
      </div>
      <div class="ops">
        <button class="act ghost" @click="targets.push({ productId: '', sets: 10 })"><Plus :size="13" :stroke-width="2" /><span>加产品</span></button>
        <button class="act primary" @click="calc">算缺口</button>
      </div>

      <template v-if="plan">
        <div class="gap-block">
          <h3>外协缺口（带结不外购——缺多少带结＝该给织女发多少同色大团原团）</h3>
          <p v-if="!(plan.outworkGaps || []).length" class="ok-line">带结库存够，不用发外协 ✓</p>
          <div v-for="g in plan.outworkGaps" :key="g.color" class="gap-line">
            <span class="gap-name">{{ g.color }}</span>
            <span>带结需 {{ g.knottedNeed }} · 存 {{ g.knottedStock }} · <strong class="short">缺 {{ g.gap }}（应发原团 {{ g.rawToIssue }}）</strong></span>
          </div>
        </div>
        <div class="gap-block">
          <h3>采购缺口（按供应商）</h3>
          <p v-if="!(plan.purchaseGroups || []).length" class="ok-line">原料都够，不用采购 ✓</p>
          <div v-for="g in plan.purchaseGroups" :key="g.supplierId" class="sup-group">
            <div class="sup-name">{{ g.supplierName }}</div>
            <div v-for="l in g.lines" :key="l.materialId" class="gap-line">
              <span class="gap-name">{{ materialHuman(l.materialId) }}{{ l.missing ? '（未建档·按需全采）' : '' }}</span>
              <span>需 {{ l.need }} · 存 {{ l.stock }} · <strong class="short">缺 {{ l.gap }}</strong></span>
            </div>
          </div>
          <p v-if="(plan.missingMaterials || []).length" class="warn-note">未建档料：{{ plan.missingMaterials.join('、') }}——先去物料页建档</p>
        </div>
      </template>
    </section>

    <section v-if="fg" class="card">
      <h2>产销统计（打包 vs 卖出）</h2>
      <div class="cols">
        <div class="col">
          <h3>打包累计（组装入库）</h3>
          <div v-for="p in fg.packed" :key="p.productId + p.spec" class="fg-line">
            <span>{{ p.productId }}{{ p.spec ? '（' + p.spec + '）' : '' }}</span><strong>{{ p.qty }} 套</strong>
          </div>
          <p v-if="!fg.packed.length" class="empty">还没打包记录</p>
        </div>
        <div class="col">
          <h3>发货累计（核销）</h3>
          <div v-for="p in fg.shipped" :key="p.productId + p.spec" class="fg-line">
            <span>{{ p.productId }}{{ p.spec ? '（' + p.spec + '）' : '' }}</span><strong>{{ p.qty }} 件</strong>
          </div>
          <p v-if="!fg.shipped.length" class="empty">还没发货核销记录</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 880px;
}
.page-head {
  margin-bottom: 16px;
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
.status {
  font-size: 13px;
  color: var(--ld-red);
  margin-bottom: 10px;
}
.card {
  padding: 18px 20px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
h3 {
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-purple-meta);
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 120px auto;
  gap: 8px;
  margin-bottom: 7px;
  align-items: center;
}
input {
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
}
.icon-x {
  width: 30px;
  height: 34px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
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
  margin: 10px 0;
}
.act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.act.primary {
  background: var(--ld-purple-ink);
  color: #fff;
}
.act.ghost {
  background: var(--ld-bg);
  color: var(--ld-content-2);
  border: 1px solid var(--ld-line);
}
.gap-block {
  padding-top: 14px;
  margin-top: 12px;
  border-top: 1px solid var(--ld-line);
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
.sup-group {
  margin-bottom: 10px;
}
.sup-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ld-brand-active);
  padding: 6px 0 2px;
}
.warn-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--ld-amber);
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 720px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
.fg-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid var(--ld-line);
  font-size: 12.5px;
  color: var(--ld-content);
}
.fg-line:first-of-type {
  border-top: none;
}
.fg-line strong {
  color: var(--ld-ink);
}
.empty {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
</style>
