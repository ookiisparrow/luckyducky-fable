<script setup>
/**
 * 「把门槛一一拆掉」区。对应原型 Sections.jsx 的 Reassurance。
 * 纯展示组件：条目由使用方传入（技术债 #4；来源可为本地默认或 content store 云端覆盖）。
 */
import Accordion from '@/components/Accordion.vue'

defineProps({ items: { type: Array, default: () => [] } })
</script>

<template>
  <view class="ld-reassure">
    <view class="ld-reassure-head">
      <text class="ld-h2">把门槛一一拆掉</text>
      <text class="ld-reassure-lead">新手学习钩织存在很多门槛，我们把这些门槛一一拆掉了。</text>
    </view>
    <Accordion :items="items" with-image />
  </view>
</template>

<style lang="scss" scoped>
.ld-reassure {
  padding: 68px $pad-page 40px;
}
.ld-reassure-head {
  margin-bottom: 20px;
}
.ld-h2 {
  display: block;
  @include ld-h2;
  text-align: left;
}
.ld-reassure-lead {
  display: block;
  font-size: 15px;
  line-height: 1.6;
  color: $content;
  margin-top: 10px;
}
</style>
