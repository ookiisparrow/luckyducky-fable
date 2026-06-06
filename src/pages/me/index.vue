<script setup>
/**
 * 「我」个人中心主页。对应原型 MyProfile.jsx（学习中枢版 A）。
 * 紫色资料头 + 继续学习卡 + 我的订单 + 客服/地址 列表。
 *
 * 真实接通：「继续观看 / 全部教程」跳已做好的 player / catalog 页。
 * 占位（Toast，子流程后续做）：编辑资料、订单各状态、全部订单、客服、地址管理。
 *
 * 图位走 MediaSlot 灰占位；my-* 类名沿用原型。
 */
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import TabBar from '@/components/TabBar.vue'
import { CONTINUE_VIDEO as V, ORDER_TABS } from '@/data/profile.js'
import { useUserStore } from '@/store/user.js'

const user = useUserStore()

function toast(t) {
  uni.showToast({ title: t, icon: 'none' })
}
function continueWatch() {
  // 接已实现的播放页
  uni.navigateTo({
    url: `/pages/player/index?name=${encodeURIComponent(V.name)}&ep=${encodeURIComponent(V.ep)}`,
  })
}
function allCourses() {
  uni.navigateTo({ url: '/pages/catalog/index' })
}
function onOrder() {
  toast('订单中心（开发中）')
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
    <view class="my-header my-header-purple">
      <view class="my-navrow"><text class="my-navtitle">我的</text></view>
      <view class="my-id">
        <view class="my-avatar"><MediaSlot ratio="1/1" :radius="31" :src="user.profile.avatar" /></view>
        <view class="my-id-text">
          <text class="my-id-name">{{ user.profile.name }}</text>
          <text class="my-id-sub">{{ user.profile.phone }}</text>
          <text v-if="user.profile.bio" class="my-id-bio">{{ user.profile.bio }}</text>
        </view>
        <view class="my-edit" @tap="goEditProfile">
          <Icon name="pencil" :size="13" /><text>编辑</text>
        </view>
      </view>
    </view>

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

        <view class="my-video" @tap="continueWatch">
          <MediaSlot ratio="16/9" />
          <view class="my-video-scrim"></view>
          <text class="my-video-dur">{{ V.at }} / {{ V.dur }}</text>
          <view class="my-play"><Icon name="play-ink" :size="22" /></view>
          <view class="my-video-cap">
            <text class="my-video-ep">{{ V.ep }}</text>
            <text class="my-video-name">{{ V.name }}</text>
          </view>
          <view class="my-prog"><view class="my-prog-fill" :style="{ width: V.pct + '%' }"></view></view>
        </view>
        <view class="my-resume">
          <text class="my-resume-text">看到 <text class="t">{{ V.at }}</text> · 还剩 4 分钟</text>
          <view class="my-resume-btn" @tap="continueWatch">
            <Icon name="play" :size="15" /><text>继续观看</text>
          </view>
        </view>
      </view>

      <!-- 我的订单 -->
      <view class="my-card my-card-pad">
        <view class="my-sec-head">
          <view class="my-sec-title"><text>我的订单</text></view>
          <view class="my-sec-more" @tap="onOrder">
            <text>全部订单</text><Icon name="chevron-right" :size="14" />
          </view>
        </view>
        <view class="my-orders">
          <view v-for="o in ORDER_TABS" :key="o.key" class="my-order" @tap="onOrder">
            <view class="my-order-ico">
              <Icon :name="o.icon" :size="25" />
              <text v-if="o.badge" class="my-order-badge">{{ o.badge }}</text>
            </view>
            <text class="my-order-label">{{ o.label }}</text>
          </view>
        </view>
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

/* 紫色资料头 */
.my-header {
  position: relative;
  padding: calc(8px + env(safe-area-inset-top)) 20px 22px;
}
.my-header-purple {
  /* 品牌紫渐变头（原型同款，渐变不入 token） */
  background: linear-gradient(160deg, #b79bea 0%, #8c6fd0 58%, #7b5caf 100%);
  color: $white;
}
.my-navrow {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 20px 4px;
  min-height: 40px;
}
.my-navtitle {
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  letter-spacing: 0.04em;
  color: $white;
}
.my-id {
  display: flex;
  align-items: center;
  margin-top: 14px;
}
.my-avatar {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  overflow: hidden;
  flex: 0 0 auto;
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.55),
    0 6px 16px rgba(54, 58, 80, 0.18);
}
.my-id-text {
  min-width: 0;
  flex: 1 1 auto;
  margin: 0 14px;
}
.my-id-name {
  display: block;
  font-family: $font-display;
  font-weight: 700;
  font-size: 22px;
  line-height: 1.15;
  color: $white;
}
.my-id-sub {
  display: block;
  font-family: $font-sans;
  font-size: 13px;
  margin-top: 5px;
  color: $white;
  opacity: 0.82;
}
.my-id-bio {
  display: block;
  font-size: 12.5px;
  line-height: 1.5;
  margin-top: 7px;
  color: $white;
  opacity: 0.9;
}
.my-edit {
  align-self: flex-start;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.2);
  color: $white;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: $r-pill;
}
.my-edit text {
  margin-left: 4px;
}
.my-edit:active {
  background: rgba(255, 255, 255, 0.32);
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

/* 继续学习视频卡 */
.my-video {
  position: relative;
  width: 100%;
  border-radius: $r-md;
  overflow: hidden;
}
.my-video-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(
    to top,
    rgba(20, 14, 30, 0.62) 0%,
    rgba(20, 14, 30, 0.12) 42%,
    rgba(20, 14, 30, 0) 70%
  );
}
.my-video-dur {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  font-family: $font-sans;
  font-size: 11px;
  color: $white;
  background: rgba(0, 0, 0, 0.5);
  padding: 3px 8px;
  border-radius: $r-pill;
}
.my-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}
.my-video-cap {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  color: $white;
}
.my-video-ep {
  display: block;
  font-family: $font-sans;
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.85;
}
.my-video-name {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 16px;
  line-height: 1.25;
  margin-top: 3px;
}
.my-prog {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.32);
  z-index: 3;
}
.my-prog-fill {
  height: 100%;
  background: $purple;
}
.my-resume {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 13px;
}
.my-resume-text {
  font-size: 13px;
  color: $content-2;
}
.my-resume-text .t {
  font-family: $font-sans;
  font-weight: 600;
  color: $content;
}
.my-resume-btn {
  display: flex;
  align-items: center;
  background: $purple-ink;
  color: $white;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 14px;
  padding: 9px 20px;
}
.my-resume-btn text {
  margin-left: 6px;
}
.my-resume-btn:active {
  opacity: 0.94;
}

/* 订单九宫格 */
.my-orders {
  display: flex;
}
.my-order {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 0;
}
.my-order-ico {
  position: relative;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.my-order-badge {
  position: absolute;
  top: -5px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: $r-pill;
  background: $red;
  color: $white;
  font-family: $font-sans;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.my-order-label {
  font-size: 12px;
  color: $content;
  margin-top: 7px;
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
