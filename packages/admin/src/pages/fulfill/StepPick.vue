<script setup>
/**
 * 步1 拣货备货（纯展示）：全部待发货订单按产品名汇总数量——照这张表备货。
 * feeMismatch 单只提示不剔除：货照备（金额核对是发货时的闸，步3 扫码会挡）。
 */
import { computed } from 'vue'
import { pickSummary } from '@/utils/fulfill.js'

const props = defineProps({ orders: { type: Array, default: () => [] } })
const summary = computed(() => pickSummary(props.orders))

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <div>
    <div class="stats">
      <span><b>{{ summary.orderCount }}</b> 单待发货</span>
      <span>共 <b>{{ summary.totalQty }}</b> 件</span>
      <span v-if="summary.earliestCreatedAt">最早一单 {{ fmtTime(summary.earliestCreatedAt) }}</span>
    </div>
    <p v-if="summary.mismatchCount" class="hint warn">
      其中 {{ summary.mismatchCount }} 单金额异常——货照备；发货前须到「订单发货」页核对流水解除，扫码发货时会被挡下。
    </p>

    <p v-if="!summary.products.length" class="hint">没有待发货订单，今天不用备货 🎉</p>
    <div v-else class="table">
      <div class="row hrow"><span class="c-name">产品</span><span class="c-num">需备数量</span></div>
      <div v-for="p in summary.products" :key="p.name" class="row">
        <span class="c-name">{{ p.name }}</span>
        <span class="c-num"><b>× {{ p.qty }}</b></span>
      </div>
    </div>
    <p class="tip">备好货后进「下一步 · 打印标签」，一单一张贴箱，照标签上的清单装货。</p>
  </div>
</template>

<style scoped>
.stats {
  display: flex;
  gap: 22px;
  font-size: 13px;
  color: var(--content);
  margin-bottom: 14px;
}
.stats b {
  font-size: 17px;
  color: var(--purple-ink);
}
.table {
  border: 1px solid var(--line);
  border-radius: 11px;
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 16px;
  font-size: 13px;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.hrow {
  background: var(--bg-lilac);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--content-2);
}
.c-name {
  flex: 1;
  min-width: 0;
  color: var(--ink);
}
.c-num {
  width: 120px;
  text-align: right;
}
.c-num b {
  color: var(--purple-ink);
  font-size: 14px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
  margin-bottom: 12px;
}
.tip {
  margin: 14px 2px 0;
  font-size: 11.5px;
  color: var(--content-2);
}
</style>
