<script setup>
/**
 * 退款 / 售后页。对应原型 Checkout.jsx 的 AfterSales。
 * 入口：我的订单「退款/售后」、订单详情「申请退款」。
 * 服务类型 + 可申请售后的订单 + 帮助入口；当前均为 Toast 占位（无真实售后系统）。
 */
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { AS_TYPES, AS_ORDERS } from '@/data/aftersales.js'

const money = (n) => Number(n).toFixed(2)

function back() {
  const p = getCurrentPages()
  if (p.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/me/index' })
}
function toast(t) {
  uni.showToast({ title: t, icon: 'none' })
}
</script>

<template>
  <view class="co">
    <view class="co-header">
      <view class="co-nav">
        <view class="co-nav-btn" @tap="back"><Icon name="chevron-left-ink" :size="22" /></view>
        <text class="co-nav-title">退款 / 售后</text>
        <view class="co-nav-spacer"></view>
      </view>
    </view>

    <view class="co-body">
      <!-- 服务类型 -->
      <view class="co-card coas-typecard">
        <text class="coas-title">选择服务类型</text>
        <view class="coas-types">
          <view v-for="(t, i) in AS_TYPES" :key="i" class="coas-type" @tap="toast(`已选择「${t.label}」`)">
            <view class="coas-type-ico"><Icon :name="t.icon" :size="21" /></view>
            <text class="coas-type-label">{{ t.label }}</text>
            <text class="coas-type-sub">{{ t.sub }}</text>
          </view>
        </view>
      </view>

      <!-- 可申请售后的订单 -->
      <view class="co-card">
        <view class="coas-sechead">
          <text class="coas-title">可申请售后的订单</text>
          <text class="coas-sechead-sub">近 90 天</text>
        </view>
        <view v-for="(o, i) in AS_ORDERS" :key="i" class="coas-order" :class="{ divided: i > 0 }">
          <view class="coas-order-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="coas-order-mid">
            <text class="coas-order-name">{{ o.name }}</text>
            <text class="coas-order-meta">{{ o.meta }}</text>
            <text class="coas-order-price"><text class="cny">￥</text>{{ money(o.price) }}</text>
          </view>
          <view class="coas-apply" @tap="toast('售后申请已提交')">申请售后</view>
        </view>
      </view>

      <!-- 帮助 -->
      <view class="co-card">
        <view class="co-row" @tap="toast('暂无处理中的申请')">
          <text class="co-row-key">售后进度查询</text>
          <text class="co-row-val muted">查看处理中的申请</text>
          <view class="co-row-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
        <view class="co-row divided" @tap="toast('正在接入人工客服…')">
          <text class="co-row-key">联系人工客服</text>
          <text class="co-row-val muted">工作日 9:00–21:00</text>
          <view class="co-row-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
      </view>

      <text class="coas-note">支持七天无理由退货 · 来回运费由商家承担，放心买</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 本页无底部坞，留出底部呼吸 */
.co-body {
  padding-bottom: 24px;
}

/* 服务类型 */
.coas-typecard {
  padding: 16px 16px 18px;
}
.coas-title {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  color: $ink;
}
.coas-types {
  display: flex;
  margin-top: 14px;
}
.coas-type {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.coas-type-ico {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}
.coas-type-label {
  font-size: 13px;
  color: $ink;
}
.coas-type-sub {
  font-size: 10.5px;
  color: $content-2;
  margin-top: 2px;
}

/* 可申请订单 */
.coas-sechead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 14px 16px 6px;
}
.coas-sechead-sub {
  font-size: 12px;
  color: $content-2;
}
.coas-order {
  display: flex;
  align-items: center;
  padding: 12px 16px;
}
.coas-order.divided {
  border-top: 0.5px solid $line-soft;
}
.coas-order-img {
  width: 64px;
  height: 64px;
  border-radius: $r-sm;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.coas-order-mid {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.coas-order-name {
  font-size: 14px;
  color: $ink;
  line-height: 1.3;
}
.coas-order-meta {
  font-family: $font-sans;
  font-size: 11.5px;
  color: $content-2;
  margin-top: 4px;
}
.coas-order-price {
  font-family: $font-sans;
  font-weight: 600;
  font-size: 15px;
  color: $ink;
  margin-top: 4px;
}
.coas-order-price .cny {
  font-size: 12px;
  margin-right: 1px;
}
.coas-apply {
  flex: 0 0 auto;
  align-self: center;
  border: 1px solid $purple;
  color: $purple;
  border-radius: $r-pill;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 14px;
  margin-left: 10px;
}
.coas-apply:active {
  background: $bg-lilac;
}

.coas-note {
  display: block;
  text-align: center;
  font-size: 12px;
  color: $purple-meta;
  line-height: 1.6;
  margin: 16px 16px 4px;
}
</style>
