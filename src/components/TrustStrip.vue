<script setup>
/**
 * 信任条：包邮到家 / 七天无理由退货 / 多数买家推荐。
 * 对应原型 Sections.jsx 的 TrustStrip。
 */
import Icon from './Icon.vue'
import { TRUST_ITEMS } from '@/data/trust.js'
</script>

<template>
  <view class="ld-trust">
    <view v-for="(it, i) in TRUST_ITEMS" :key="i" class="ld-trust-item">
      <Icon :name="it.icon" :size="24" />
      <text class="ld-trust-label">{{ it.label }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-trust {
  background: $bg-lilac;
  display: flex;
  justify-content: center;
  gap: 34px;
  padding: 30px 10px;
  border-top: 0.5px solid #efe9f4;
  border-bottom: 0.5px solid #efe9f4;
}
.ld-trust-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.ld-trust-label {
  font-family: $font-display;
  font-size: 12px;
  color: #6b5c84;
}
</style>
