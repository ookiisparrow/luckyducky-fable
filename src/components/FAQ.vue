<script setup>
/**
 * 「大家都在问」FAQ 区。对应原型 Sections.jsx 的 FAQ。
 */
import Accordion from './Accordion.vue'
import { FAQ_ITEMS } from '@/data/faq.js'
</script>

<template>
  <view class="ld-faq">
    <text class="ld-h1">大家都在问</text>
    <view class="ld-faq-group">
      <Accordion :items="FAQ_ITEMS" variant="faq" />
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
