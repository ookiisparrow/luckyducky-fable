<script setup>
/**
 * 评分汇总（大分 + 星 + 条数 + 分布条 + 标签）。商品详情与「全部评价」共用。
 * 此前 pdp-rate-head / pdp-chips 的 markup + 样式在 detail / reviews 各复制一份。
 */
import { stars } from '@/utils/format.js'

defineProps({
  rating: { type: Object, required: true }, // { score, count, dist:[[label,pct]], tags:[[name,count]] }
})
</script>

<template>
  <view>
    <view class="pdp-rate-head">
      <view class="pdp-rate-score">
        <text class="pdp-rate-big">{{ rating.score }}</text>
        <text class="pdp-stars">{{ stars(5) }}</text>
        <text class="pdp-rate-count">{{ rating.count }} 条评价</text>
      </view>
      <view class="pdp-rate-bars">
        <view v-for="([k, v], i) in rating.dist" :key="i" class="pdp-rate-bar">
          <text class="pdp-rate-k">{{ k }}</text>
          <view class="pdp-rate-track"><view class="pdp-rate-fill" :style="{ width: v + '%' }"></view></view>
        </view>
      </view>
    </view>
    <view class="pdp-chips">
      <view v-for="([t, n], i) in rating.tags" :key="i" class="pdp-chip">
        <text>{{ t }}</text><text class="pdp-chip-n">{{ n }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.pdp-rate-head {
  display: flex;
  align-items: center;
  padding: 14px 20px 8px;
}
.pdp-rate-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 auto;
  margin-right: 20px;
}
.pdp-rate-big {
  font-family: $font-sans;
  font-size: 34px;
  font-weight: 700;
  color: $ink;
  line-height: 1;
}
.pdp-stars {
  color: $duck-deep;
  font-size: 13px;
  letter-spacing: 1.5px;
}
.pdp-rate-score .pdp-stars {
  margin-top: 4px;
}
.pdp-rate-count {
  font-size: 11px;
  color: $content-2;
  margin-top: 4px;
}
.pdp-rate-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.pdp-rate-bar {
  display: flex;
  align-items: center;
  margin-bottom: 5px;
}
.pdp-rate-k {
  font-size: 11px;
  color: $content-2;
  width: 26px;
  flex: 0 0 26px;
}
.pdp-rate-track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: $line;
  overflow: hidden;
  margin-left: 8px;
}
.pdp-rate-fill {
  height: 100%;
  background: $duck-deep;
  border-radius: 3px;
}
.pdp-chips {
  display: flex;
  flex-wrap: wrap;
  padding: 8px 20px 14px;
}
.pdp-chip {
  font-size: 12.5px;
  color: $content;
  background: $bg-grey;
  border-radius: $r-pill;
  padding: 6px 12px;
  margin: 0 8px 8px 0;
}
.pdp-chip-n {
  color: $content-2;
  font-family: $font-sans;
  margin-left: 3px;
}
</style>
