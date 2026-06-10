<script setup>
/**
 * 结算页 · 固定提交坞（页内组件，技术债 #5 自 index.vue 拆出）。
 * 提交守卫逻辑在页面（onSubmit）；接云订单 / 支付时提交态（loading / 校验文案）在这里扩展。
 */
import { money } from '@/utils/format.js'

defineProps({
  pay: { type: Number, default: 0 },
  count: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['submit'])
</script>

<template>
  <view class="co-dock">
    <view class="co-dock-total">
      <text class="co-dock-small">合计</text>
      <view class="co-dock-amount">
        <text class="co-dock-amt"><text class="cny">￥</text>{{ money(pay) }}</text>
        <text class="co-dock-count">共 {{ count }} 件</text>
      </view>
    </view>
    <view class="co-submit" :class="{ disabled }" @tap="emit('submit')">提交订单</view>
  </view>
</template>

<style lang="scss" scoped>
/* 与 co.scss 同名的取值收在 co-mixins.scss 单一来源（scoped 够不到 co.scss，故 @include） */
@import '../../../styles/co-mixins.scss';

/* 横排底部坞（提交按钮靠右） */
.co-dock {
  @include co-dock;
  display: flex;
  align-items: center;
}
.co-dock-total {
  @include co-dock-total;
}
.co-dock-small {
  @include co-dock-small;
}
.co-dock-amt {
  @include co-dock-amt;
}
.co-dock-amount {
  display: flex;
  align-items: baseline;
}
.co-dock-count {
  font-size: 12px;
  color: $content-2;
  font-family: $font-sans;
  margin-left: 8px;
}
.co-submit {
  margin-left: auto;
  flex: 0 0 auto;
  background: $purple;
  color: $white;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 16px;
  padding: 14px 34px;
}
.co-submit:active {
  opacity: 0.94;
}
.co-submit.disabled {
  background: $line-strong;
  opacity: 0.6;
}
</style>
