<script setup>
/**
 * 地址管理页。对应原型 Checkout.jsx 的 AddressManage。
 * 入口：我的页「地址管理」、结算页点收货地址。
 * 列表由 store/address.js 驱动：点卡片设为默认、点笔编辑、底部新增。
 */
import Icon from '@/components/Icon.vue'
import { useAddressStore } from '@/store/address.js'

const address = useAddressStore()

function back() {
  const p = getCurrentPages()
  if (p.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/me/index' })
}
function pick(a) {
  address.setDefault(a.id)
  uni.showToast({ title: '已设为默认地址', icon: 'none' })
}
function edit(a) {
  uni.navigateTo({ url: `/pages/address-edit/index?id=${a.id}` })
}
function add() {
  uni.navigateTo({ url: '/pages/address-edit/index' })
}
</script>

<template>
  <view class="co">
    <view class="co-header">
      <view class="co-nav">
        <view class="co-nav-btn" @tap="back"><Icon name="chevron-left-ink" :size="22" /></view>
        <text class="co-nav-title">地址管理</text>
        <view class="co-nav-spacer"></view>
      </view>
    </view>

    <view class="co-body">
      <view v-if="address.list.length === 0" class="coam-empty">
        <view class="coam-empty-ico"><Icon name="map-pin-off" :size="28" /></view>
        <text class="coam-empty-title">还没有收货地址</text>
        <text class="coam-empty-sub">添加一个常用地址，下单时一键带入</text>
      </view>

      <view v-for="a in address.list" :key="a.id" class="co-card coam-card">
        <view class="coam-main" @tap="pick(a)">
          <view class="coam-radio" :class="{ on: a.isDefault }">
            <Icon v-if="a.isDefault" name="check" :size="12" />
          </view>
          <view class="coam-text">
            <view class="coam-line1">
              <text class="coam-name">{{ a.name }}</text>
              <text class="coam-phone">{{ a.phone }}</text>
              <text v-if="a.isDefault" class="co-addr-tag">默认</text>
            </view>
            <text class="coam-addr">{{ (a.region ? a.region + ' ' : '') + a.detail }}</text>
          </view>
        </view>
        <view class="coam-edit" @tap="edit(a)"><Icon name="square-pen" :size="19" /></view>
      </view>
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-add" @tap="add"><Icon name="plus" :size="18" /><text>新增收货地址</text></view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.co {
  min-height: 100vh;
  background: $bg-grey;
  font-family: $font-cn;
  color: $content;
}

/* 顶部导航（结算系列同款） */
.co-header {
  background: $white;
  padding: calc(6px + env(safe-area-inset-top)) 0 0;
  border-bottom: 0.5px solid $line;
}
.co-nav {
  display: flex;
  align-items: center;
  padding: 2px 16px 12px;
}
.co-nav-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.co-nav-btn:active {
  background: rgba(0, 0, 0, 0.06);
}
.co-nav-title {
  flex: 1;
  text-align: center;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.co-nav-spacer {
  width: 34px;
  flex: 0 0 auto;
}

.co-body {
  padding: 12px 14px 4px;
}
.co-card {
  background: $white;
  border-radius: $r-md;
  box-shadow: $shadow-soft;
  overflow: hidden;
  margin-bottom: 12px;
}

/* 地址卡 */
.coam-card {
  display: flex;
  align-items: stretch;
}
.coam-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  padding: 16px;
}
.coam-radio {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid $line-strong;
  background: $white;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  margin-right: 12px;
}
.coam-radio.on {
  background: $purple;
  border-color: $purple;
}
.coam-text {
  min-width: 0;
  flex: 1 1 auto;
}
.coam-line1 {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}
.coam-name {
  font-family: $font-display;
  font-weight: 500;
  font-size: 16px;
  color: $ink;
}
.coam-phone {
  font-family: $font-sans;
  font-size: 14px;
  color: $content;
  margin-left: 10px;
}
.co-addr-tag {
  font-size: 10.5px;
  color: $purple;
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
  border-radius: 4px;
  padding: 1px 6px;
  margin-left: 8px;
}
.coam-addr {
  display: block;
  font-size: 13.5px;
  color: $content-2;
  line-height: 1.5;
  margin-top: 6px;
}
.coam-edit {
  flex: 0 0 auto;
  align-self: center;
  border-left: 0.5px solid $line-soft;
  padding: 0 16px;
  display: flex;
  align-items: center;
}

/* 空态 */
.coam-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 70px 28px;
}
.coam-empty-ico {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: $bg-lilac;
  border: 1px solid $purple-line;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}
.coam-empty-title {
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.coam-empty-sub {
  font-size: 13.5px;
  color: $content-2;
  line-height: 1.6;
  margin-top: 8px;
}

/* 底部新增 */
.co-foot {
  height: calc(78px + env(safe-area-inset-bottom));
}
.co-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  background: $white;
  box-shadow: 0 -1px 0 $line;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
}
.co-add {
  height: 48px;
  border-radius: $r-pill;
  background: $purple;
  color: $white;
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.co-add text {
  margin-left: 6px;
}
.co-add:active {
  opacity: 0.94;
}
</style>
