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
@import '../../styles/co.scss';

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
/* 此页徽标在姓名/手机之后 → 左间距 */
.coam-line1 .co-addr-tag {
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
