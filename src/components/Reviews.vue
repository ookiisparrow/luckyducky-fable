<script setup>
/**
 * 「真实买家秀」区。对应原型 Sections.jsx 的 Reviews。
 * 纯展示组件：评价列表由使用方传入（技术债 #4，评价上云后换云端来源）。
 */
import ReviewCard from './ReviewCard.vue'

defineProps({ reviews: { type: Array, default: () => [] } })
const emit = defineEmits(['more'])
</script>

<template>
  <view class="ld-reviews">
    <view class="ld-reviews-head">
      <text class="ld-h2">真实买家秀</text>
      <text class="ld-reviews-more" @tap="emit('more')">全部 ›</text>
    </view>
    <scroll-view scroll-x class="ld-rail" :show-scrollbar="false">
      <ReviewCard v-for="r in reviews" :key="r.id" :review="r" />
      <view class="ld-rail-end"></view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.ld-reviews {
  background: $bg-grey;
  padding: 28px 0;
}
.ld-reviews-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 $pad-page 18px;
}
.ld-h2 {
  @include ld-h2;
}
.ld-reviews-more {
  font-size: 13px;
  color: $purple;
}
.ld-rail {
  white-space: nowrap;
  padding: 4px 0 4px $pad-page;
}
.ld-rail-end {
  display: inline-block;
  width: 8px;
}
</style>
