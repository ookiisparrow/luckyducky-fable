<script setup>
/**
 * 购物车（占位页）。保证底部 Tab 可切换、不报错。
 * 后续在此实现购物车明细 / 结算流程（见 store/cart.js、api/shop.js）。
 */
import Icon from '@/components/Icon.vue'
import TabBar from '@/components/TabBar.vue'

function goShop() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="ld-page">
    <view class="ld-page-head">
      <text class="ld-page-title">购物车</text>
    </view>
    <view class="ld-empty">
      <view class="ld-empty-ico">
        <Icon name="shopping-cart-on" :size="30" />
      </view>
      <text class="ld-empty-title">购物车空空的</text>
      <text class="ld-empty-sub">还没有心动的小棉鸭～此页将在后续迭代中完善。</text>
      <view class="ld-empty-btn" @tap="goShop">
        <text class="ld-empty-btn-text">看看推荐</text>
      </view>
    </view>
    <TabBar active="cart" />
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/placeholder.scss';
</style>
