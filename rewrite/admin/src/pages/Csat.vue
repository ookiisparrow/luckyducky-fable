<script setup lang="ts">
// 客服满意度（设计语言一致性·M3 UI 批15）：均分 + 星级分布 + 带备注数（越界分云端已剔）。逻辑未动，仅套设计语言。
import { ref, onMounted } from 'vue'
import { getCsatReport } from '../api/cs'
import { mapCsat } from '../lib/mapCs'

const vm = ref<ReturnType<typeof mapCsat>>(null)
const message = ref('加载中…')

onMounted(async () => {
  const r = await getCsatReport()
  vm.value = mapCsat(r)
  message.value = vm.value ? '' : '加载失败：' + String(r.error || '')
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>客服满意度</h1>
      <p class="sub">均分 + 星级分布 + 带备注数（越界分云端已剔除，只统计有效评分）。</p>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="vm" class="card">
      <div class="score-row">
        <div class="score">{{ vm.avg }}</div>
        <div class="score-meta">
          <div class="meta-line"><strong>{{ vm.total }}</strong> 条评分</div>
          <div class="meta-line"><strong>{{ vm.withNote }}</strong> 条带备注</div>
          <div v-if="vm.approxNote" class="approx">{{ vm.approxNote }}</div>
        </div>
      </div>
      <div class="dist">
        <div v-for="d in vm.dist" :key="d.star" class="dist-row">
          <span class="star">{{ d.star }}</span>
          <div class="bar"><div class="fill" :style="{ width: vm.total ? (d.n / vm.total) * 100 + '%' : '0' }" /></div>
          <span class="n">{{ d.n }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 560px;
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
  color: var(--ld-content-2);
}
.card {
  padding: 22px 24px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.score-row {
  display: flex;
  align-items: center;
  gap: 20px;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--ld-line);
}
.score {
  font-size: 46px;
  font-weight: 700;
  color: var(--ld-brand);
  line-height: 1;
}
.score-meta {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.meta-line {
  padding: 2px 0;
}
.meta-line strong {
  color: var(--ld-ink);
  font-size: 14px;
}
.approx {
  margin-top: 4px;
  font-size: 11px;
  color: var(--ld-amber);
}
.dist-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 0;
}
.star {
  width: 40px;
  flex: none;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.bar {
  flex: 1;
  height: 10px;
  background: var(--ld-bg-faint);
  border-radius: 999px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--ld-brand);
  border-radius: 999px;
}
.n {
  width: 40px;
  flex: none;
  text-align: right;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-ink);
}
</style>
