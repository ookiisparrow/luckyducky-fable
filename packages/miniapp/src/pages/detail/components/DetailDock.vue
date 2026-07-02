<script setup>
/**
 * 商品详情 · 固定底部购买坞（客服 / 收藏 / 加入购物车 / 立即购买）。从 detail 页拆出。
 * 自身只发事件，把购物车/下单逻辑留在父页。含给 fixed 坞让位的 pdp-foot 占位（双根）。
 */
import Icon from '@/components/Icon.vue'

defineEmits(['service', 'favorite', 'cart', 'buy'])
</script>

<template>
  <view class="pdp-foot"></view>
  <view class="pdp-dock">
    <!-- 客服：emit 交父级调 openCustomerService（R18/⑨ 升级独立微信客服·决策§19；展示组件不做副作用·§6） -->
    <view class="pdp-buy-ico" @tap="$emit('service')">
      <Icon name="headphones" :size="21" /><text class="pdp-buy-ico-txt">客服</text>
    </view>
    <view class="pdp-buy-ico" @tap="$emit('favorite')">
      <Icon name="star" :size="21" /><text class="pdp-buy-ico-txt">收藏</text>
    </view>
    <view class="pdp-buy-actions">
      <view class="pdp-btn pdp-btn-cart" @tap="$emit('cart')">加入购物车</view>
      <view class="pdp-btn pdp-btn-buy" @tap="$emit('buy')">立即购买</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.pdp-foot {
  height: calc(78px + env(safe-area-inset-bottom));
}
.pdp-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: $white;
  border-top: 0.5px solid $line;
}
.pdp-buy-ico {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: $content;
  padding: 4px 6px;
  flex: 0 0 auto;
}
.pdp-buy-ico-txt {
  font-size: 10px;
  margin-top: 2px;
}
.pdp-buy-actions {
  flex: 1;
  display: flex;
  margin-left: 4px;
}
.pdp-btn {
  flex: 1;
  height: 46px;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 15px;
  color: $white;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pdp-btn:active {
  transform: translateY(1px);
}
.pdp-btn-cart {
  background: $purple-ink;
  margin-right: 9px;
}
.pdp-btn-buy {
  background: $purple;
}
</style>
