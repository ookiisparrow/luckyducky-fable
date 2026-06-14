<script setup>
/**
 * 「真实买家秀」区。对应原型 Sections.jsx 的 Reviews。
 * 纯展示组件：评价列表由使用方传入（技术债 #4，评价上云后换云端来源）。
 */
import ReviewCard from '@/components/ReviewCard.vue'

defineProps({ reviews: { type: Array, default: () => [] } })
</script>

<template>
  <view class="ld-reviews">
    <scroll-view scroll-x class="ld-rail" :show-scrollbar="false">
      <ReviewCard v-for="r in reviews" :key="r.id" :review="r" />
      <view class="ld-rail-end"></view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.ld-reviews {
  background: $bg-grey;
  padding: 28px 0; /* 上下对称：上 28+4 / 下 4+28（rail 自带 4） */
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
