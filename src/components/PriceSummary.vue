<script setup>
/**
 * 金额明细（商品金额 / 运费 / 优惠券 / 实付款）。
 * 此前在 checkout / order / pending-pay 里逐字复制 3 份，现收口成组件。
 * 样式从 co.scss 移到此处（只有本组件用 co-summary）。
 */
import { money } from '@/utils/format.js'

defineProps({
  goods: { type: Number, required: true }, // 商品金额
  coupon: { type: Number, default: 0 }, // 优惠券抵扣
  ship: { type: Number, default: 0 }, // 运费（0=包邮）
  total: { type: Number, required: true }, // 实付/需付
  totalLabel: { type: String, default: '实付款' },
})
</script>

<template>
  <view class="co-card">
    <view class="co-summary">
      <view class="co-sum-row">
        <text class="co-sum-k">商品金额</text><text class="co-sum-b">￥{{ money(goods) }}</text>
      </view>
      <view class="co-sum-row">
        <text class="co-sum-k">运费</text>
        <text class="co-sum-b">{{ ship === 0 ? '￥0.00（包邮）' : '￥' + money(ship) }}</text>
      </view>
      <view class="co-sum-row discount">
        <text class="co-sum-k">优惠券</text><text class="co-sum-b">-￥{{ money(coupon) }}</text>
      </view>
      <view class="co-sum-div"></view>
      <view class="co-sum-row total">
        <text class="co-sum-k">{{ totalLabel }}</text>
        <text class="co-sum-b"><text class="cny">￥</text>{{ money(total) }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.co-card {
  background: $white;
  border-radius: $r-md;
  box-shadow: $shadow-soft;
  overflow: hidden;
  margin-bottom: 12px;
}
.co-summary {
  margin: 4px 12px 14px;
  background: $bg-faint;
  border-radius: $r-md;
  padding: 14px 16px;
}
.co-sum-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
}
.co-sum-k {
  font-size: 13.5px;
  color: $content-2;
}
.co-sum-b {
  font-family: $font-sans;
  font-weight: 500;
  font-size: 14px;
  color: $content;
}
.co-sum-row.discount .co-sum-b {
  color: $red;
}
.co-sum-div {
  height: 0.5px;
  background: $line;
  margin: 7px 0;
}
.co-sum-row.total .co-sum-k {
  font-size: 14px;
  color: $ink;
}
.co-sum-row.total .co-sum-b {
  font-weight: 700;
  font-size: 18px;
  color: $ink;
}
.co-sum-row.total .cny {
  font-size: 13px;
}
</style>
