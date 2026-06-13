<script setup>
/**
 * 数量步进器（−/n/＋）。购物车、结算页（商品 + 搭配）共用。
 * 只发 inc/dec 事件，由各页决定下限与「减到下限再减」的处理
 * （购物车减到 1 再减 → 弹确认移除；结算页夹到最小 1）。
 * size：'md'=购物车（28px，1px 边框，无内分隔）；'sm'=结算（26px，0.5px 边框，数字两侧分隔线）。
 * 两套尺寸按各自设计稿保留，未强行统一。
 */
defineProps({
  n: { type: Number, required: true },
  size: { type: String, default: 'md' }, // 'md' | 'sm'
})
defineEmits(['inc', 'dec'])
</script>

<template>
  <view class="qs" :class="'qs-' + size">
    <view class="qs-btn" @tap="$emit('dec')">−</view>
    <text class="qs-n">{{ n }}</text>
    <view class="qs-btn" @tap="$emit('inc')">＋</view>
  </view>
</template>

<style lang="scss" scoped>
.qs {
  display: flex;
  align-items: center;
  border-radius: $r-pill;
  overflow: hidden;
}
.qs-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  color: $ink;
}
.qs-btn:active {
  background: $bg-grey;
}
.qs-n {
  text-align: center;
  font-family: $font-sans;
  color: $ink;
}

/* md：购物车（28px，1px 边框，无内分隔） */
.qs-md {
  border: 1px solid $line-strong;
}
.qs-md .qs-btn {
  width: 28px;
  height: 28px;
  font-size: 16px;
}
.qs-md .qs-n {
  min-width: 28px;
  font-size: 13px;
}

/* sm：结算（26px，0.5px 边框，数字两侧分隔线） */
.qs-sm {
  height: 26px;
  border: 0.5px solid $line-strong;
}
.qs-sm .qs-btn {
  width: 30px;
  height: 26px;
  font-size: 15px;
}
.qs-sm .qs-n {
  min-width: 34px;
  font-size: 14px;
  line-height: 26px;
  border-left: 0.5px solid $line-strong;
  border-right: 0.5px solid $line-strong;
}
</style>
