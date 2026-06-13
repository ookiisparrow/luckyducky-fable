<script setup>
/**
 * 结算页 · 搭配购买卡（页内组件，技术债 #5 自 index.vue 拆出）。
 * 纯展示：条目与勾选 / 数量状态由页面持有（金额联动在页面算），这里只发事件。
 */
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import QuantityStepper from '@/components/QuantityStepper.vue'
import { money } from '@/utils/format.js'

defineProps({ addons: { type: Array, default: () => [] } })
const emit = defineEmits(['toggle', 'set-qty'])
</script>

<template>
  <view class="co-card">
    <view class="co-addon-head">
      <text class="co-addon-title">搭配购买</text>
      <text class="co-addon-sub">一起买更划算</text>
    </view>
    <view v-for="(a, i) in addons" :key="a.id" class="co-addon" :class="{ divided: i > 0 }">
      <view class="co-radio" :class="{ on: a.on }" @tap="emit('toggle', i)">
        <Icon v-if="a.on" name="check" :size="12" />
      </view>
      <view class="co-addon-img"><MediaSlot ratio="1/1" :radius="5" /></view>
      <view class="co-addon-mid">
        <text class="co-addon-name">{{ a.name }}</text>
        <view class="co-addon-foot">
          <text class="co-price co-addon-price"><text class="cny">￥</text>{{ money(a.price) }}</text>
          <QuantityStepper
            :n="a.qty"
            size="sm"
            @dec="emit('set-qty', i, a.qty - 1)"
            @inc="emit('set-qty', i, a.qty + 1)"
          />
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 与 co.scss 同名的取值收在 co-mixins.scss 单一来源（scoped 够不到 co.scss，故 @include） */
@import '../../../styles/co-mixins.scss';

.co-card {
  @include co-card;
}
.co-price {
  @include co-price;
}
.co-price .cny {
  font-size: 13px;
  margin-right: 1px;
}

/* 以下 co-addon-* / co-radio 为结算页专属，自页面整体迁入 */
.co-addon-head {
  display: flex;
  align-items: baseline;
  padding: 14px 16px 2px;
}
.co-addon-title {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  color: $ink;
}
.co-addon-sub {
  font-size: 12px;
  color: $duck-orange;
  margin-left: 8px;
}
.co-addon {
  display: flex;
  align-items: center;
  padding: 12px 16px;
}
.co-addon.divided {
  border-top: 0.5px solid $line-soft;
}
.co-radio {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid $line-strong;
  background: $white;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}
.co-radio.on {
  background: $purple;
  border-color: $purple;
}
.co-addon-img {
  width: 56px;
  height: 56px;
  border-radius: $r-sm;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.co-addon-mid {
  flex: 1 1 auto;
  min-width: 0;
}
.co-addon-name {
  font-size: 14px;
  color: $ink;
  line-height: 1.3;
}
.co-addon-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 9px;
}
.co-addon-price {
  font-size: 15px;
}
</style>
