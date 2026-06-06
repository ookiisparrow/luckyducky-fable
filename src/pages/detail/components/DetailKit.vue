<script setup>
/**
 * 商品详情 · 套装包含（图标 + 名称 + 数量 的小格子）。从 detail 页拆出。
 * 外层 pdp-sec 白卡与标题仍在父页。
 */
import Icon from '@/components/Icon.vue'

defineProps({
  kit: { type: Array, default: () => [] }, // [{ icon, name, qty }, ...]
})
</script>

<template>
  <view class="pdp-kit">
    <view v-for="(k, i) in kit" :key="i" class="pdp-kit-cell">
      <view class="pdp-kit-ico"><Icon :name="k.icon" :size="19" /></view>
      <view class="pdp-kit-text">
        <text class="pdp-kit-name">{{ k.name }}</text>
        <text class="pdp-kit-qty">{{ k.qty }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.pdp-kit {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 6px 20px 18px;
}
.pdp-kit-cell {
  width: calc(50% - 6px);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  background: $white;
  border: 1px solid $line-soft;
  border-radius: $r-md;
  padding: 14px;
  margin-bottom: 12px;
}
.pdp-kit-ico {
  width: 34px;
  height: 34px;
  border-radius: $r-xs;
  background: $bg-lilac;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 11px;
}
.pdp-kit-name {
  display: block;
  font-size: 14px;
  color: $ink;
  line-height: 1.3;
}
.pdp-kit-qty {
  display: block;
  font-size: 11px;
  color: $content-2;
  font-family: $font-sans;
  margin-top: 2px;
}

</style>
