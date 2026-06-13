<script setup>
/**
 * 收货地址块（图钉 + 姓名/手机 + 默认徽标 + 详细地址 + 底部缝线）。
 * 结算 / 订单 / 待付 三页共用 —— 此前 co-addr 整块 markup 在三页各复制一份。
 * - address 有值：显示地址；tappable 时整行可点（emit tap）并显示右箭头。
 * - address 为空 + tappable：显示「添加收货地址」引导（结算页用）。
 * - address 为空 + 非 tappable：整块不渲染（订单/待付，等价原 v-if="addr"）。
 */
import Icon from './Icon.vue'

const props = defineProps({
  address: { type: Object, default: null }, // { name, phone, region, detail, isDefault }
  tappable: { type: Boolean, default: false },
})
const emit = defineEmits(['tap'])
function onTap() {
  if (props.tappable) emit('tap')
}
</script>

<template>
  <view v-if="address || tappable" class="co-addr">
    <view class="co-addr-main" @tap="onTap">
      <view class="co-addr-pin"><Icon name="map-pin" :size="24" /></view>
      <view v-if="address" class="co-addr-text">
        <view class="co-addr-line1">
          <text class="co-addr-name">{{ address.name }}</text>
          <text class="co-addr-phone">{{ address.phone }}</text>
        </view>
        <view class="co-addr-line2">
          <text v-if="address.isDefault" class="co-addr-tag">默认</text>
          <text class="co-addr-detail">{{ (address.region ? address.region + ' ' : '') + address.detail }}</text>
        </view>
      </view>
      <view v-else class="co-addr-text">
        <text class="co-addr-empty-title">添加收货地址</text>
        <text class="co-addr-empty-sub">请先填写收货人、手机号与详细地址</text>
      </view>
      <view v-if="tappable" class="co-addr-chev"><Icon name="chevron-right" :size="19" /></view>
    </view>
    <view class="co-stitch"></view>
  </view>
</template>

<style lang="scss" scoped>
/* 与 co.scss 同名的取值收在 co-mixins.scss 单一来源（scoped 够不到 co.scss，故 @include） */
@import '../styles/co-mixins.scss';

.co-addr {
  background: $white;
  border-radius: $r-md;
  box-shadow: $shadow-soft;
  margin-bottom: 12px;
}
.co-addr-main {
  display: flex;
  align-items: center;
  padding: 18px 14px 20px;
}
.co-addr-pin {
  width: 26px;
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  margin-right: 13px;
}
.co-addr-text {
  flex: 1 1 auto;
  min-width: 0;
}
.co-addr-line1 {
  display: flex;
  align-items: baseline;
}
.co-addr-name {
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.co-addr-phone {
  font-family: $font-sans;
  font-size: 14px;
  color: $content;
  margin-left: 12px;
}
.co-addr-line2 {
  font-size: 13.5px;
  color: $content-2;
  line-height: 1.5;
  margin-top: 6px;
}
/* 「默认」徽标：与地址管理卡（coam-）同款，取值在 co-mixins.scss 单一来源。
   此块里徽标在详情前 → 右间距是本组件的布局差异，显式另加。 */
.co-addr-tag {
  @include co-addr-tag;
  margin-right: 6px;
}
.co-addr-chev {
  flex: 0 0 auto;
  display: flex;
  margin-left: 8px;
}
.co-addr-empty-title {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 16px;
  color: $ink;
}
.co-addr-empty-sub {
  display: block;
  font-size: 12.5px;
  color: $content-2;
  line-height: 1.5;
  margin-top: 5px;
}
.co-stitch {
  height: 4px;
  border-radius: 0 0 $r-md $r-md;
  overflow: hidden;
  background-image: repeating-linear-gradient(
    72deg,
    $duck-orange 0 6px,
    transparent 6px 7px,
    $purple 7px 13px,
    transparent 13px 14px
  );
}
</style>
