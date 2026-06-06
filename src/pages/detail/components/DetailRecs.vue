<script setup>
/**
 * 商品详情 · 为你推荐（两列商品小卡）。从 detail 页拆出。
 * 点击发 pick 事件、把商品交回父页处理（现为 Toast 占位）。外层 pdp-sec 仍在父页。
 */
import MediaSlot from '@/components/MediaSlot.vue'

defineProps({
  recs: { type: Array, default: () => [] }, // [{ name, price, was }, ...]
})
defineEmits(['pick'])
</script>

<template>
  <view class="pdp-recs">
    <view v-for="(p, i) in recs" :key="i" class="pdp-rec" @tap="$emit('pick', p)">
      <MediaSlot ratio="1/1" />
      <view class="pdp-rec-body">
        <text class="pdp-rec-name">{{ p.name }}</text>
        <view class="pdp-rec-foot">
          <text class="pdp-rec-now">￥{{ p.price }}</text>
          <text class="pdp-rec-was">￥{{ p.was }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.pdp-recs {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 10px 20px 20px;
}
.pdp-rec {
  width: calc(50% - 6px);
  box-sizing: border-box;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-sm;
  overflow: hidden;
  margin-bottom: 12px;
}
.pdp-rec:active {
  transform: scale(0.985);
}
.pdp-rec-body {
  padding: 10px 12px 12px;
}
.pdp-rec-name {
  display: block;
  font-size: 13.5px;
  color: $ink;
  line-height: 1.3;
}
.pdp-rec-foot {
  display: flex;
  align-items: baseline;
  margin-top: 7px;
}
.pdp-rec-now {
  font-family: $font-sans;
  font-weight: 600;
  font-size: 16px;
  color: $ink;
}
.pdp-rec-was {
  font-family: $font-sans;
  font-size: 11px;
  color: $content-2;
  text-decoration: line-through;
  margin-left: 6px;
}
</style>
