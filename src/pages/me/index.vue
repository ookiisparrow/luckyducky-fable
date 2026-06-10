<script setup>
/**
 * 「我」个人中心主页。对应原型 MyProfile.jsx（学习中枢版 A）。
 * 紫色资料头 + 继续学习卡 + 我的订单 + 客服/地址 列表。
 *
 * 真实接通：「继续观看」→ 播放页续播；「全部教程」→ 首次进视频课先放欢迎引导页、之后直达目录；
 *   订单九宫格 / 全部订单 → 订单列表页（真实订单，角标按 store 数量）；退款/售后仍样例（P4 接真）。
 * 占位（Toast，子流程后续做）：客服。
 *
 * 图位走 MediaSlot 灰占位；my-* 类名沿用原型。
 */
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import TabBar from '@/components/TabBar.vue'
import ProfileHeader from './components/ProfileHeader.vue'
import ContinueVideo from './components/ContinueVideo.vue'
import OrderGrid from './components/OrderGrid.vue'
import { CONTINUE_VIDEO as V, ORDER_TABS } from '@/data/profile.js'
import { useUserStore } from '@/store/user.js'
import { useOrdersStore } from '@/store/orders.js'
import { STORAGE_KEYS } from '@/constants/storage.js'

const user = useUserStore()
const orders = useOrdersStore()

// 角标 = 各状态真实订单数（只标可办理的三态，已完成/售后不标）
const BADGE_STATUS = { pending: 'pending', toship: 'paid', toreceive: 'shipped' }
const orderTabs = computed(() =>
  ORDER_TABS.map((t) => ({ ...t, badge: orders.countByStatus[BADGE_STATUS[t.key]] || 0 })),
)
onShow(() => orders.load())

function toast(t) {
  uni.showToast({ title: t, icon: 'none' })
}
function continueWatch() {
  // 续播课程表里进行中的那节（l3 · 看懂图解里的符号）
  uni.navigateTo({ url: '/pages/player/index?id=l3' })
}
function allCourses() {
  // 首次进视频课先看欢迎引导，之后直达目录
  const seen = uni.getStorageSync(STORAGE_KEYS.VIDEO_INTRO_SEEN)
  uni.navigateTo({ url: seen ? '/pages/catalog/index' : '/pages/welcome/index' })
}
function onOrder(key) {
  if (key === 'refund') uni.navigateTo({ url: '/pages/aftersales/index' })
  else uni.navigateTo({ url: `/pages/order-list/index?tab=${key}` })
}
function allOrders() {
  uni.navigateTo({ url: '/pages/order-list/index' })
}
function goAddress() {
  uni.navigateTo({ url: '/pages/address/index' })
}
function goEditProfile() {
  uni.navigateTo({ url: '/pages/profile-edit/index' })
}
</script>

<template>
  <view class="my-profile">
    <!-- 紫色资料头 -->
    <ProfileHeader :profile="user.profile" @edit="goEditProfile" />

    <view class="my-stack">
      <!-- 继续学习 -->
      <view class="my-card my-card-pad">
        <view class="my-sec-head">
          <view class="my-sec-title">
            <view class="my-sec-ico"><Icon name="graduation-cap" :size="19" /></view>
            <text>继续学习</text>
          </view>
          <view class="my-sec-more" @tap="allCourses">
            <text>全部教程</text><Icon name="chevron-right" :size="14" />
          </view>
        </view>

        <ContinueVideo :v="V" @watch="continueWatch" />
      </view>

      <!-- 我的订单 -->
      <view class="my-card my-card-pad">
        <view class="my-sec-head">
          <view class="my-sec-title"><text>我的订单</text></view>
          <view class="my-sec-more" @tap="allOrders">
            <text>全部订单</text><Icon name="chevron-right" :size="14" />
          </view>
        </view>
        <OrderGrid :tabs="orderTabs" @open="onOrder" />
      </view>

      <!-- 客服 / 地址 -->
      <view class="my-card my-list">
        <view class="my-row" @tap="toast('正在接入人工客服…')">
          <view class="my-row-ico"><Icon name="headphones-meta" :size="22" /></view>
          <text class="my-row-label">联系客服</text>
          <view class="my-row-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
        <view class="my-row divided" @tap="goAddress">
          <view class="my-row-ico"><Icon name="map-pin-meta" :size="22" /></view>
          <text class="my-row-label">地址管理</text>
          <view class="my-row-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
      </view>
    </view>

    <view class="my-pad-bottom"></view>
    <TabBar active="me" />
  </view>
</template>

<style lang="scss" scoped>
.my-profile {
  min-height: 100vh;
  background: $bg-grey;
  font-family: $font-cn;
}


/* 内容堆叠 */
.my-stack {
  padding: 8px 20px 0;
}
.my-card {
  background: $white;
  border-radius: $r-md;
  border: 1px solid $line;
  box-shadow: $shadow-soft;
  margin-bottom: 16px;
}
.my-card-pad {
  padding: 16px;
}
.my-pad-bottom {
  height: 112px;
}

.my-sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
}
.my-sec-title {
  display: flex;
  align-items: center;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.my-sec-ico {
  display: flex;
  margin-right: 7px;
}
.my-sec-more {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: $content-2;
}
.my-sec-more text {
  margin-right: 2px;
}


/* 列表行 */
.my-list {
  overflow: hidden;
}
.my-row {
  display: flex;
  align-items: center;
  padding: 15px 16px;
}
.my-row.divided {
  border-top: 1px solid $line;
}
.my-row-ico {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 13px;
}
.my-row-label {
  flex: 1 1 auto;
  font-size: 15px;
  color: $ink;
}
.my-row-chev {
  display: flex;
}
</style>
