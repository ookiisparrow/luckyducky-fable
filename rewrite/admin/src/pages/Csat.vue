<script setup lang="ts">
// 客服满意度（设计语言一致性·M3 UI 批15）：均分 + 星级分布 + 带备注数（越界分云端已剔）。逻辑未动，仅套设计语言。
// 不编数（根因#8·T3）：mapCsat 只给 avg/total/withNote/dist——设计稿的「评价明细表」「坐席排名」「区间对比」无数据源，一律不建。
// 好评率/差评数从 dist 派生（真·非造）；「近 30 天」区间 chip 无数据源故省略。
import { ref, onMounted, computed } from 'vue'
import { RotateCcw, Star, ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-vue-next'
import { getCsatReport } from '../api/cs'
import { mapCsat } from '../lib/mapCs'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

const vm = ref<ReturnType<typeof mapCsat>>(null)
const message = ref('加载中…')
const busy = ref(false)

// 派生纯展示（真·非造）：好评＝4–5 星、差评＝1–2 星，按 star 文案解析档位后求和
const badCount = computed(() => (vm.value?.dist || []).filter((d) => parseInt(d.star) <= 2).reduce((s, d) => s + d.n, 0))
const goodRate = computed(() => {
  const t = vm.value?.total || 0
  if (!t) return '0%'
  const good = (vm.value?.dist || []).filter((d) => parseInt(d.star) >= 4).reduce((s, d) => s + d.n, 0)
  return Math.round((good / t) * 1000) / 10 + '%'
})

async function load() {
  busy.value = true
  const r = await getCsatReport()
  busy.value = false
  vm.value = mapCsat(r)
  message.value = vm.value ? '' : '加载失败：' + String(r.error || '')
}
onMounted(load)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="客户满意度" sub="均分 + 星级分布 + 带备注数（越界分云端已剔除，只统计有效评分）。">
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="load">
        <RotateCcw :size="14" :stroke-width="1.8" /><span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <EmptyState v-else-if="vm && !vm.total" :icon="Star" text="还没有顾客评价——顾客在客服会话里点 ⭐ 评价后出现在这里。" />

    <template v-else-if="vm && vm.total">
      <div class="ld-kpi-grid">
        <KpiCard label="CSAT 均分" :value="vm.avg" :icon="Star">
          <span class="kpi-note">满分 5 分</span>
        </KpiCard>
        <KpiCard label="好评率" :value="goodRate" :icon="ThumbsUp">
          <span class="kpi-note">满意 + 非常满意（4–5 星）占比</span>
        </KpiCard>
        <KpiCard label="参评量" :value="vm.total" :icon="MessageSquare">
          <span class="kpi-note">其中 {{ vm.withNote }} 条带备注</span>
        </KpiCard>
        <KpiCard label="差评数" :value="badCount" :icon="ThumbsDown" tone="red">
          <span class="kpi-note">1–2 星评价</span>
        </KpiCard>
      </div>

      <Card title="评分分布" sub="按星级统计有效评分（越界分云端已剔除）">
        <div v-if="vm.approxNote" class="dist-approx"><Badge tone="amber">{{ vm.approxNote }}</Badge></div>
        <div class="dist">
          <div v-for="d in vm.dist" :key="d.star" class="dist-row">
            <span class="star">{{ d.star }}</span>
            <div class="bar"><div class="fill" :style="{ width: vm.total ? (d.n / vm.total) * 100 + '%' : '0' }" /></div>
            <span class="n">{{ d.n }}<em class="pct">{{ vm.total ? Math.round((d.n / vm.total) * 100) : 0 }}%</em></span>
          </div>
        </div>
      </Card>
    </template>
  </div>
</template>

<style scoped>
.kpi-note {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.dist-approx {
  margin-bottom: 12px;
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
  width: 78px;
  flex: none;
  text-align: right;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-ink);
}
.pct {
  margin-left: 6px;
  font-style: normal;
  font-weight: 400;
  font-size: 11px;
  color: var(--ld-content-2);
}
</style>
