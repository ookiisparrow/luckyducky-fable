<script setup lang="ts">
// 备货计算 + 产销统计（M3 批7·只读）：目标套数 → 外协缺口（带结不外购）+ 采购缺口按供应商分列；
// 产销 = 打包累计 vs 发货累计。
import { ref, onMounted } from 'vue'
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
  <div>
    <h2>备货计算 & 产销</h2>
    <p v-if="message" class="status">{{ message }}</p>

    <div class="panel">
      <h3>备货计算器（只读·不动账）</h3>
      <div v-for="(t, i) in targets" :key="i" class="linerow">
        <input v-model="t.productId" placeholder="产品 id" />
        <input v-model.number="t.sets" type="number" min="1" placeholder="目标套数" />
        <button class="act ghost" @click="targets.splice(i, 1)">删</button>
      </div>
      <div class="ops">
        <button class="act ghost" @click="targets.push({ productId: '', sets: 10 })">+ 加产品</button>
        <button class="act" @click="calc">算缺口</button>
      </div>

      <template v-if="plan">
        <h4>外协缺口（带结不外购——缺多少带结＝该给织女发多少同色大团原团）</h4>
        <p v-if="!(plan.outworkGaps || []).length" class="ok-line">带结库存够，不用发外协 ✓</p>
        <p v-for="g in plan.outworkGaps" :key="g.color" class="row-line">
          {{ g.color }}：带结需 {{ g.knottedNeed }}·存 {{ g.knottedStock }}·<strong>缺 {{ g.gap }}（应发原团 {{ g.rawToIssue }}）</strong>
        </p>
        <h4>采购缺口（按供应商）</h4>
        <p v-if="!(plan.purchaseGroups || []).length" class="ok-line">原料都够，不用采购 ✓</p>
        <div v-for="g in plan.purchaseGroups" :key="g.supplierId" class="group">
          <strong>{{ g.supplierName }}</strong>
          <p v-for="l in g.lines" :key="l.materialId" class="row-line">
            {{ materialHuman(l.materialId) }}{{ l.missing ? '（未建档·按需全采）' : '' }}：需 {{ l.need }}·存 {{ l.stock }}·缺 {{ l.gap }}
          </p>
        </div>
        <p v-if="(plan.missingMaterials || []).length" class="warn-note">未建档料：{{ plan.missingMaterials.join('、') }}——先去物料页建档</p>
      </template>
    </div>

    <div v-if="fg" class="panel">
      <h3>产销统计（打包 vs 卖出）</h3>
      <div class="cols">
        <div>
          <h4>打包累计（组装入库）</h4>
          <p v-for="p in fg.packed" :key="p.productId + p.spec" class="row-line">{{ p.productId }}{{ p.spec ? '（' + p.spec + '）' : '' }}：{{ p.qty }} 套</p>
          <p v-if="!fg.packed.length" class="row-line">还没打包记录</p>
        </div>
        <div>
          <h4>发货累计（核销）</h4>
          <p v-for="p in fg.shipped" :key="p.productId + p.spec" class="row-line">{{ p.productId }}{{ p.spec ? '（' + p.spec + '）' : '' }}：{{ p.qty }} 件</p>
          <p v-if="!fg.shipped.length" class="row-line">还没发货核销记录</p>
        </div>
      </div>
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
  margin: 12px 0 6px;
  font-size: 13px;
  color: var(--ld-purple-ink);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.panel {
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 760px;
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 110px auto;
  gap: 8px;
  margin-bottom: 6px;
}
input {
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.ops {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.row-line {
  font-size: 13px;
  margin: 3px 0;
}
.ok-line {
  font-size: 13px;
  color: var(--ld-green);
}
.warn-note {
  font-size: 12px;
  color: var(--ld-amber);
}
.group {
  margin: 6px 0;
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.act {
  padding: 6px 16px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
}
</style>
