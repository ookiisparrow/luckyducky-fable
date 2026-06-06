<script setup>
/**
 * 订单商品行（图 + 名 + 规格徽标 + 价格 + 右侧数量/步进）。
 * 结算 / 订单 / 待付 三页共用 —— 此前 co-item 整块 markup 在三页各复制一份。
 * 右下角默认显示「×数量」；结算页通过 #foot 插槽换成 QuantityStepper（可改数量）。
 * 注：co-item-spec / co-price / .cny 是跨处共用的原子类（评价页、搭配购买也在用），
 *     因组件 scoped 隔离够不到 co.scss，这里各带一份；co.scss 也保留一份给组件外的用处。
 */
import MediaSlot from './MediaSlot.vue'
import { money } from '@/utils/format.js'

defineProps({
  name: { type: String, required: true },
  spec: { type: String, default: '' },
  price: { type: Number, required: true },
  qty: { type: Number, default: 1 },
})
</script>

<template>
  <view class="co-item">
    <view class="co-item-img"><MediaSlot ratio="1/1" :radius="5" /></view>
    <view class="co-item-mid">
      <text class="co-item-name">{{ name }}</text>
      <text v-if="spec" class="co-item-spec">{{ spec }}</text>
      <view class="co-item-foot">
        <text class="co-price co-item-price"><text class="cny">￥</text>{{ money(price) }}</text>
        <slot name="foot"><text class="co-item-qty">×{{ qty }}</text></slot>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.co-item {
  display: flex;
  padding: 14px 16px;
}
.co-item-img {
  width: 80px;
  height: 80px;
  border-radius: $r-sm;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.co-item-mid {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.co-item-name {
  font-size: 15px;
  color: $ink;
  line-height: 1.35;
}
.co-item-spec {
  align-self: flex-start;
  font-size: 11.5px;
  color: $content-2;
  background: $bg-grey;
  border-radius: 4px;
  padding: 3px 8px;
  margin-top: 7px;
}
.co-item-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 10px;
}
.co-item-qty {
  font-family: $font-sans;
  font-size: 13px;
  color: $content-2;
}
.co-price {
  font-family: $font-sans;
  font-weight: 600;
  color: $ink;
}
.co-price .cny {
  font-size: 13px;
  margin-right: 1px;
}
.co-item-price {
  font-size: 19px;
}
</style>
