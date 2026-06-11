<script setup>
/**
 * 「大家都在问」FAQ 区。对应原型 Sections.jsx 的 FAQ。
 * 纯展示组件：条目由使用方传入（技术债 #4，数据将来可换云端来源）。
 */
import Accordion from '@/components/Accordion.vue'

defineProps({ items: { type: Array, default: () => [] } })
</script>

<template>
  <view class="ld-faq">
    <text class="ld-h1">大家都在问</text>
    <view class="ld-faq-group">
      <Accordion :items="items" variant="faq" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-faq {
  background: $bg-lilac;
  padding: 38px 14px 44px;
}
.ld-h1 {
  display: block;
  @include ld-h1;
  text-align: center;
}
.ld-faq-group {
  margin-top: 22px;
}
</style>
