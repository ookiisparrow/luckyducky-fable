<script setup>
/**
 * 「我」个人中心（占位页）。保证底部 Tab 可切换、不报错。
 * 后续在此实现资料 / 订单 / 教程等（见 store/user.js、api/user.js）。
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
      <text class="ld-page-title">我</text>
    </view>
    <view class="ld-empty">
      <view class="ld-empty-ico">
        <Icon name="user-on" :size="30" />
      </view>
      <text class="ld-empty-title">个人中心</text>
      <text class="ld-empty-sub">登录、订单、教程等功能将在后续迭代中上线。</text>
      <view class="ld-empty-btn" @tap="goShop">
        <text class="ld-empty-btn-text">回到首页</text>
      </view>
    </view>
    <TabBar active="me" />
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/placeholder.scss';
</style>
