<script setup lang="ts">
// 客服满意度（M3 批5）：均分 + 星级分布 + 带备注数（越界分云端已剔）。
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
  <div>
    <h2>客服满意度</h2>
    <p v-if="message" class="status">{{ message }}</p>
    <div v-if="vm" class="panel">
      <div class="scorerow">
        <span class="score">{{ vm.avg }}</span>
        <span class="meta">{{ vm.total }} 条评分 · {{ vm.withNote }} 条带备注 <em v-if="vm.approxNote">{{ vm.approxNote }}</em></span>
      </div>
      <div v-for="d in vm.dist" :key="d.star" class="dist">
        <span class="star">{{ d.star }}</span>
        <div class="bar"><div class="fill" :style="{ width: vm.total ? (d.n / vm.total) * 100 + '%' : '0' }"></div></div>
        <span class="n">{{ d.n }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
.status {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.panel {
  padding: 18px 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 480px;
}
.scorerow {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 14px;
}
.score {
  font-size: 40px;
  font-weight: 700;
  color: var(--ld-purple-ink);
}
.meta {
  font-size: 12px;
  color: var(--ld-purple-meta);
}
.meta em {
  color: var(--ld-amber);
  font-style: normal;
}
.dist {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}
.star {
  width: 44px;
  font-size: 12px;
  color: var(--ld-purple-meta);
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
  background: var(--ld-purple);
}
.n {
  width: 40px;
  text-align: right;
  font-size: 12px;
}
</style>
