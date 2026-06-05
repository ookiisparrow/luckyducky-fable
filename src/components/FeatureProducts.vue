<script setup>
/**
 * 「入门钩织的妙趣方案」+ 横滑产品。对应原型 Sections.jsx 的 Friends。
 */
import MediaSlot from './MediaSlot.vue'
import ProductCard from './ProductCard.vue'
import { PRODUCTS } from '@/data/products.js'

defineProps({
  flashId: { type: String, default: '' }, // 命中要高亮的产品 id
})
const emit = defineEmits(['open', 'add'])
</script>

<template>
  <view class="ld-friends">
    <MediaSlot ratio="1/1" :radius="9" label="放入图片" />

    <view class="ld-feature-copy">
      <text class="ld-feature-title">入门钩织的妙趣方案</text>
      <text class="ld-feature-body">为了让钩织入门更轻松、更有趣，我们精心设计了这些小家伙。</text>
    </view>

    <scroll-view scroll-x class="ld-prod-rail" :show-scrollbar="false">
      <ProductCard
        v-for="p in PRODUCTS"
        :key="p.id"
        :product="p"
        :flash="flashId === p.id"
        @open="emit('open', p)"
        @add="emit('add', p)"
      />
      <view class="ld-rail-end"></view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.ld-friends {
  padding: 24px $pad-page 36px;
}
.ld-feature-copy {
  margin-top: 68px;
}
.ld-feature-title {
  display: block;
  @include ld-h2;
  line-height: 1.25;
}
.ld-feature-body {
  display: block;
  font-size: 15px;
  line-height: 1.65;
  color: $content;
  margin-top: 12px;
  max-width: 75%;
}
.ld-prod-rail {
  margin-top: 12px;
  white-space: nowrap;
  /* 让卡片可以越过 .ld-friends 的右内边距一直滑到边缘 */
  margin-right: -#{$pad-page};
}
.ld-rail-end {
  display: inline-block;
  width: 8px;
}
</style>
